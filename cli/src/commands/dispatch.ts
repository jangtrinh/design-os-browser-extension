import { DEFAULT_BROKER_HOST, DEFAULT_BROKER_PORT } from '../../../shared/rpc-envelope.js';
import { callBrokerReaderApi, callBrokerRpc, fetchBrokerHealth, queryCacheWithFallback } from '../daemon/client.js';
import { readLinkedInComments } from './linkedin-comments.js';
import { loadOrCreatePairingToken, resolvePairingFilePath } from '../daemon/pairing.js';
import { redactToken } from '../daemon/request-guard.js';
import { runDoctor } from './doctor.js';
import { startBrokerServer } from '../daemon/ws-broker.js';
import { runMcpStdioLoop } from '../mcp/stdio-server.js';

export interface ParsedFlags {
  positional: string[];
  flags: Record<string, string | boolean>;
}

export function parseCliArgs(argv: string[]): ParsedFlags {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const eqIdx = arg.indexOf('=');
    if (eqIdx !== -1) {
      const k = arg.slice(2, eqIdx);
      const v = arg.slice(eqIdx + 1);
      flags[k] = v;
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags[key] = next;
      i += 1;
    } else {
      flags[key] = true;
    }
  }
  return { positional, flags };
}

function outJson(payload: unknown, exitCode = 0): number {
  const verdict = exitCode === 0 ? 'AGENT_OK' : 'AGENT_FAIL';
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n${verdict} ${JSON.stringify(payload)}\n`);
  return exitCode;
}

function getHelpText(): string {
  return [
    'browser-agent — DESIGN:OS Cross-Browser Agent RPC + LinkedIn Zero-Drift CLI',
    '',
    'Commands:',
    '  daemon start [--port 4347] [--fixtures]',
    '  daemon status [--json]',
    '  daemon token [--reveal] [--json]',
    '  doctor [--port 4347] [--json]',
    '  capabilities [--json]',
    '  observe [--tab <id>] [--url <url>] [--max-nodes <n>] [--json]',
    '  act --op <click_ref|fill_ref> --ref <n> --page-id <id> --epoch <n> --lease-id <id> [--tab <id>] [--value <text>] [--approval-id <id>] [--json]',
    '  linkedin status [--url <url>] [--json]',
    '  linkedin search [--category people|posts|jobs|companies] [--query <q>] [--url <url>] [--json]',
    '  linkedin profile [--public-id <id>] [--url <url>] [--json]',
    '  linkedin post [--urn <urn>] [--url <url>] [--json]',
    '  linkedin company [--slug <slug>] [--url <url>] [--json]',
    '  linkedin job [--job-id <id>] [--url <url>] [--json]',
    '  linkedin inbox [--thread-id <id>] [--url <url>] [--json]',
    '  linkedin feed [--url <url>] [--json]',
    '  linkedin analytics [--url <profile|analytics|post url>] [--json]',
    '  linkedin comments [--urn <urn>] [--url <post url>] [--latest --public-id <id>] [--json]',
    '  linkedin draft --kind <message|comment|post|connect_note> --target <id> --body <text> [--prefill] [--url <url>] [--json]',
    '  linkedin queue [--status <pending|prefilled|approved|rejected>] [--json]',
    '  linkedin cache --sql "SELECT ..." [--json]',
    '  reader list [--site <site>] [--json]',
    '  reader read --site <site> --view <view> [--target <url>] [--max-age-s <n>] [--evidence <off|json|json+screenshot>] [--bot <name>] [--routine <name>] [--json]',
    '  reader check --check <duplicate_text|profile_links|link_status|subreddit_rules> [--params <json>] [--json]',
    '  reader cache [--sql "SELECT ..." | --site <site> --view <view>] [--json]',
    '  reader pacing [--site <site>] [--json]',
    '  reader guard [--site <site>] [--json]',
    '  reader evidence --evidence-id <id> [--json]',
    '  reader audit [--since <iso>] [--site <site>] [--caller <bot>] [--json]',
    '  mcp   (start MCP JSON-RPC 2.0 stdio server)',
  ].join('\n');
}

export async function dispatchCli(argv: string[]): Promise<number> {
  const { positional, flags } = parseCliArgs(argv);
  const cmd = positional[0];
  const sub = positional[1];
  const port = flags.port ? Number(flags.port) : undefined;
  const brokerCfg = { host: DEFAULT_BROKER_HOST, port };

  if (!cmd || cmd === 'help' || flags.help) {
    process.stdout.write(`${getHelpText()}\n`);
    return 0;
  }

  if (cmd === 'mcp') {
    runMcpStdioLoop(brokerCfg);
    return -1; // keep stdio loop open
  }

  if (cmd === 'daemon') {
    if (sub === 'token') {
      const token = loadOrCreatePairingToken();
      // The raw token is shown only on explicit --reveal, for pasting into the extension popup.
      return outJson({
        ok: true,
        ...(flags.reveal ? { token } : { tokenRedacted: redactToken(token), hint: 'Pass --reveal to print the token for pairing.' }),
        pairingFile: resolvePairingFilePath(),
        wsUrl: `ws://${DEFAULT_BROKER_HOST}:${port ?? DEFAULT_BROKER_PORT}/ws`,
      });
    }

    if (sub === 'status') {
      const health = await fetchBrokerHealth(brokerCfg);
      return outJson(health, health.reachable ? 0 : 1);
    }

    if (sub === 'start') {
      const existing = await fetchBrokerHealth(brokerCfg);
      if (existing.reachable) {
        return outJson({
          ok: true,
          reusedExistingBroker: true,
          ...existing.data,
        });
      }
      const broker = await startBrokerServer({
        port,
        enableFixtures: Boolean(flags.fixtures),
      });
      process.stdout.write(
        `${JSON.stringify({
          ok: true,
          listening: `http://${broker.host}:${broker.port}`,
          wsUrl: `ws://${broker.host}:${broker.port}/ws`,
          tokenRedacted: redactToken(broker.token),
          pairingFile: resolvePairingFilePath(),
          dbPath: broker.cache.dbPath,
        })}\n`,
      );
      await new Promise<void>((resolve) => {
        const stop = (): void => {
          void broker.close().then(() => {
            process.stdout.write(`AGENT_OK ${JSON.stringify({ ok: true, stopped: true })}\n`);
            resolve();
          });
        };
        process.once('SIGINT', stop);
        process.once('SIGTERM', stop);
      });
      return 0;
    }
  }

  if (cmd === 'reader') {
    if (sub === 'list') {
      const res = await callBrokerReaderApi('/reader/list', {
        ...(typeof flags.site === 'string' ? { site: flags.site } : {}),
      }, brokerCfg);
      return outJson(res, res.ok ? 0 : 1);
    }
    if (sub === 'read') {
      const extraParams = typeof flags.params === 'string' ? (JSON.parse(flags.params) as Record<string, unknown>) : {};
      const res = await callBrokerReaderApi('/reader/read', {
        site: String(flags.site ?? 'generic'),
        view: String(flags.view ?? ''),
        ...(typeof flags.target === 'string' ? { target: flags.target } : {}),
        ...(typeof flags['max-age-s'] === 'string' ? { max_age_s: Number(flags['max-age-s']) } : {}),
        ...(typeof flags.evidence === 'string' ? { evidence: flags.evidence } : {}),
        caller: {
          bot: typeof flags.bot === 'string' ? flags.bot : 'cli',
          routine: typeof flags.routine === 'string' ? flags.routine : 'manual',
        },
        params: extraParams,
      }, brokerCfg);
      return outJson(res, res.ok ? 0 : 1);
    }
    if (sub === 'check') {
      const paramsObj = typeof flags.params === 'string' ? (JSON.parse(flags.params) as Record<string, unknown>) : {};
      const res = await callBrokerReaderApi('/reader/check', {
        check: String(flags.check ?? ''),
        params: paramsObj,
        caller: {
          bot: typeof flags.bot === 'string' ? flags.bot : 'cli',
          routine: typeof flags.routine === 'string' ? flags.routine : 'manual',
        },
      }, brokerCfg);
      return outJson(res, res.ok ? 0 : 1);
    }
    if (sub === 'cache') {
      const res = await callBrokerReaderApi('/reader/query', {
        ...(typeof flags.sql === 'string' ? { sql: flags.sql } : {}),
        ...(typeof flags.site === 'string' ? { site: flags.site } : {}),
        ...(typeof flags.view === 'string' ? { view: flags.view } : {}),
        ...(typeof flags['target-key'] === 'string' ? { target_key: flags['target-key'] } : {}),
        ...(typeof flags.since === 'string' ? { since: flags.since } : {}),
      }, brokerCfg);
      return outJson(res, res.ok ? 0 : 1);
    }
    if (sub === 'pacing') {
      const res = await callBrokerReaderApi('/reader/pacing', {
        ...(typeof flags.site === 'string' ? { site: flags.site } : {}),
      }, brokerCfg);
      return outJson(res, res.ok ? 0 : 1);
    }
    if (sub === 'guard') {
      const res = await callBrokerReaderApi('/reader/guard', {
        ...(typeof flags.site === 'string' ? { site: flags.site } : {}),
      }, brokerCfg);
      return outJson(res, res.ok ? 0 : 1);
    }
    if (sub === 'evidence') {
      const res = await callBrokerReaderApi('/reader/evidence', {
        evidence_id: String(flags['evidence-id'] ?? ''),
      }, brokerCfg);
      return outJson(res, res.ok ? 0 : 1);
    }
    if (sub === 'audit') {
      const res = await callBrokerReaderApi('/reader/audit', {
        ...(typeof flags.since === 'string' ? { since: flags.since } : {}),
        ...(typeof flags.site === 'string' ? { site: flags.site } : {}),
        ...(typeof flags.caller === 'string' ? { caller: flags.caller } : {}),
      }, brokerCfg);
      return outJson(res, res.ok ? 0 : 1);
    }
  }

  if (cmd === 'doctor') {
    const report = await runDoctor(brokerCfg);
    return outJson(report, report.ok ? 0 : 1);
  }

  if (cmd === 'capabilities') {
    const res = await callBrokerRpc('browser.capabilities', {}, brokerCfg);
    return outJson(res, res.ok ? 0 : 1);
  }

  if (cmd === 'observe') {
    const res = await callBrokerRpc(
      'browser.observe',
      {
        ...(typeof flags.url === 'string' ? { url: flags.url } : {}),
        ...(typeof flags['max-nodes'] === 'string' ? { maxNodes: Number(flags['max-nodes']) } : {}),
      },
      {
        ...brokerCfg,
        ...(typeof flags.tab === 'string'
          ? { fence: { tabId: Number(flags.tab), pageId: '', epoch: 0, leaseId: '' } }
          : {}),
      },
    );
    return outJson(res, res.ok ? 0 : 1);
  }

  if (cmd === 'act') {
    const res = await callBrokerRpc(
      'browser.act',
      {
        op: String(flags.op ?? 'click_ref'),
        ref: Number(flags.ref ?? -1),
        ...(typeof flags.value === 'string' ? { value: flags.value } : {}),
        ...(typeof flags['approval-id'] === 'string' ? { approvalId: flags['approval-id'] } : {}),
      },
      {
        ...brokerCfg,
        fence: {
          tabId: Number(flags.tab ?? 0),
          pageId: String(flags['page-id'] ?? ''),
          epoch: Number(flags.epoch ?? 0),
          leaseId: String(flags['lease-id'] ?? ''),
        },
      },
    );
    return outJson(res, res.ok ? 0 : 1);
  }

  if (cmd === 'linkedin') {
    if (sub === 'cache') {
      const sql = String(flags.sql ?? 'SELECT public_identifier, full_name, headline, source, captured_at FROM profiles LIMIT 25');
      const res = await queryCacheWithFallback(sql, brokerCfg);
      return outJson(res, res.ok ? 0 : 1);
    }

    if (sub === 'status') {
      const res = await callBrokerRpc(
        'linkedin.status',
        { ...(typeof flags.url === 'string' ? { url: flags.url } : {}) },
        brokerCfg,
      );
      return outJson(res, res.ok ? 0 : 1);
    }

    if (sub === 'search') {
      const res = await callBrokerRpc(
        'linkedin.search',
        {
          category: typeof flags.category === 'string' ? flags.category : 'people',
          query: typeof flags.query === 'string' ? flags.query : '',
          ...(typeof flags.url === 'string' ? { url: flags.url } : {}),
        },
        brokerCfg,
      );
      return outJson(res, res.ok ? 0 : 1);
    }

    if (sub === 'profile') {
      const res = await callBrokerRpc(
        'linkedin.profile.get',
        {
          ...(typeof flags['public-id'] === 'string' ? { publicId: flags['public-id'] } : {}),
          ...(typeof flags.url === 'string' ? { url: flags.url } : {}),
        },
        brokerCfg,
      );
      return outJson(res, res.ok ? 0 : 1);
    }

    if (sub === 'post') {
      const res = await callBrokerRpc(
        'linkedin.post.get',
        {
          ...(typeof flags.urn === 'string' ? { postUrn: flags.urn } : {}),
          ...(typeof flags.url === 'string' ? { url: flags.url } : {}),
        },
        brokerCfg,
      );
      return outJson(res, res.ok ? 0 : 1);
    }

    if (sub === 'company') {
      const res = await callBrokerRpc(
        'linkedin.company.get',
        {
          ...(typeof flags.slug === 'string' ? { slug: flags.slug } : {}),
          ...(typeof flags.url === 'string' ? { url: flags.url } : {}),
        },
        brokerCfg,
      );
      return outJson(res, res.ok ? 0 : 1);
    }

    if (sub === 'job') {
      const res = await callBrokerRpc(
        'linkedin.job.get',
        {
          ...(typeof flags['job-id'] === 'string' ? { jobId: flags['job-id'] } : {}),
          ...(typeof flags.url === 'string' ? { url: flags.url } : {}),
        },
        brokerCfg,
      );
      return outJson(res, res.ok ? 0 : 1);
    }

    if (sub === 'inbox') {
      const hasThread = typeof flags['thread-id'] === 'string';
      const res = await callBrokerRpc(
        hasThread ? 'linkedin.inbox.thread' : 'linkedin.inbox.list',
        {
          ...(hasThread ? { threadId: flags['thread-id'] } : {}),
          ...(typeof flags.url === 'string' ? { url: flags.url } : {}),
        },
        brokerCfg,
      );
      return outJson(res, res.ok ? 0 : 1);
    }

    if (sub === 'feed') {
      const res = await callBrokerRpc(
        'linkedin.feed.read',
        { ...(typeof flags.url === 'string' ? { url: flags.url } : {}) },
        brokerCfg,
      );
      return outJson(res, res.ok ? 0 : 1);
    }

    if (sub === 'analytics') {
      const res = await callBrokerRpc(
        'linkedin.analytics.read',
        { ...(typeof flags.url === 'string' ? { url: flags.url } : {}) },
        brokerCfg,
      );
      return outJson(res, res.ok ? 0 : 1);
    }

    if (sub === 'comments') {
      const res = await readLinkedInComments(
        {
          ...(typeof flags.urn === 'string' ? { postUrn: flags.urn } : {}),
          ...(typeof flags.url === 'string' ? { url: flags.url } : {}),
          ...(typeof flags['public-id'] === 'string' ? { publicId: flags['public-id'] } : {}),
          latest: Boolean(flags.latest),
        },
        brokerCfg,
      );
      return outJson(res, res.ok ? 0 : 1);
    }

    if (sub === 'draft') {
      const res = await callBrokerRpc(
        'linkedin.draft.create',
        {
          kind: typeof flags.kind === 'string' ? flags.kind : 'message',
          target: typeof flags.target === 'string' ? flags.target : 'unknown',
          body: typeof flags.body === 'string' ? flags.body : '',
          prefill: Boolean(flags.prefill),
          ...(typeof flags.url === 'string' ? { url: flags.url } : {}),
        },
        brokerCfg,
      );
      return outJson(res, res.ok ? 0 : 1);
    }

    if (sub === 'queue') {
      const res = await callBrokerRpc(
        'linkedin.queue.list',
        { ...(typeof flags.status === 'string' ? { status: flags.status } : {}) },
        brokerCfg,
      );
      return outJson(res, res.ok ? 0 : 1);
    }
  }

  return outJson(
    { ok: false, error: { code: 'UNKNOWN_COMMAND', message: `Unknown command: ${argv.join(' ')}` } },
    1,
  );
}
