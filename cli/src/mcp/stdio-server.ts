import { createInterface } from 'node:readline';
import { PROTOCOL_VERSION } from '../../../shared/rpc-envelope.js';
import { readLinkedInComments } from '../commands/linkedin-comments.js';
import { callBrokerRpc, queryCacheWithFallback, type BrokerClientConfig } from '../daemon/client.js';

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const MCP_TOOLS: McpToolDef[] = [
  {
    name: 'browser_capabilities',
    description: 'Inspect attached extension browser capability tier and active adapters.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_observe',
    description: 'Capture compact accessible DOM snapshot and current (pageId, epoch, leaseId) fence.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: { type: 'number' },
        url: { type: 'string' },
        maxNodes: { type: 'number' },
      },
    },
  },
  {
    name: 'browser_act',
    description: 'Fenced click_ref or fill_ref on an allowlisted host. Read-only clicks (navigation, show more, pagination) run directly; writes (send, like, comment, connect, typing) return BLOCKED_POLICY with an approvalId until a human allows that exact act in the extension popup.',
    inputSchema: {
      type: 'object',
      required: ['op', 'ref', 'tabId', 'pageId', 'epoch', 'leaseId'],
      properties: {
        op: { type: 'string', enum: ['click_ref', 'fill_ref'] },
        ref: { type: 'number' },
        value: { type: 'string' },
        approvalId: { type: 'string' },
        tabId: { type: 'number' },
        pageId: { type: 'string' },
        epoch: { type: 'number' },
        leaseId: { type: 'string' },
      },
    },
  },
  {
    name: 'linkedin_status',
    description: 'Check LinkedIn session status, Human Gate state, pacing counters, and Copilot queue depth.',
    inputSchema: { type: 'object', properties: { tabId: { type: 'number' } } },
  },
  {
    name: 'linkedin_search',
    description: 'Extract structured LinkedIn search results (people, posts, jobs, companies) from the accessibility tree.',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: ['people', 'posts', 'jobs', 'companies'] },
        query: { type: 'string' },
        url: { type: 'string' },
      },
    },
  },
  {
    name: 'linkedin_get_profile',
    description: 'Read a LinkedIn person profile into normalized JSON and cache into local SQLite.',
    inputSchema: {
      type: 'object',
      properties: {
        publicId: { type: 'string' },
        url: { type: 'string' },
      },
    },
  },
  {
    name: 'linkedin_get_post',
    description: 'Read a LinkedIn post/activity into normalized JSON and cache into local SQLite.',
    inputSchema: {
      type: 'object',
      properties: { postUrn: { type: 'string' }, url: { type: 'string' } },
    },
  },
  {
    name: 'linkedin_get_company',
    description: 'Read a LinkedIn company page into normalized JSON and cache into local SQLite.',
    inputSchema: {
      type: 'object',
      properties: { slug: { type: 'string' }, url: { type: 'string' } },
    },
  },
  {
    name: 'linkedin_get_job',
    description: 'Read a LinkedIn job posting into normalized JSON and cache into local SQLite.',
    inputSchema: {
      type: 'object',
      properties: { jobId: { type: 'string' }, url: { type: 'string' } },
    },
  },
  {
    name: 'linkedin_read_analytics',
    description: 'Read followers, connections, profile viewers, post impressions, search appearances and per-post impressions/engagements from a profile, creator analytics, profile-views or post page.',
    inputSchema: { type: 'object', properties: { url: { type: 'string' } } },
  },
  {
    name: 'linkedin_read_comments',
    description: 'Read comments already rendered on a post (never clicks to expand), or on the newest post of a profile with latest=true and publicId.',
    inputSchema: {
      type: 'object',
      properties: {
        postUrn: { type: 'string' },
        url: { type: 'string' },
        latest: { type: 'boolean' },
        publicId: { type: 'string' },
      },
    },
  },
  {
    name: 'linkedin_list_inbox',
    description: 'List LinkedIn messaging inbox threads or read a single thread when threadId is given.',
    inputSchema: {
      type: 'object',
      properties: { threadId: { type: 'string' }, url: { type: 'string' } },
    },
  },
  {
    name: 'linkedin_draft_write',
    description: 'Stage a Copilot draft (message, comment, post, connect_note) into human approval queue and optionally prefill visible composer without clicking Send.',
    inputSchema: {
      type: 'object',
      required: ['kind', 'target', 'body'],
      properties: {
        kind: { type: 'string', enum: ['message', 'comment', 'post', 'connect_note'] },
        target: { type: 'string' },
        body: { type: 'string' },
        prefill: { type: 'boolean' },
        url: { type: 'string' },
      },
    },
  },
  {
    name: 'linkedin_query_cache',
    description: 'Run fast read-only SELECT / WITH SQL queries over locally cached LinkedIn profiles, posts, companies, jobs, threads, searches, and queue items.',
    inputSchema: {
      type: 'object',
      required: ['sql'],
      properties: { sql: { type: 'string' } },
    },
  },
];

export async function handleMcpJsonRpcMessage(
  msg: Record<string, unknown>,
  brokerCfg: BrokerClientConfig = {},
): Promise<Record<string, unknown> | null> {
  const id = msg.id ?? null;
  const method = String(msg.method ?? '');
  const params = (msg.params as Record<string, unknown> | undefined) ?? {};

  if (method === 'notifications/initialized') {
    return null;
  }

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: {
          name: 'design-os-browser-agent',
          version: PROTOCOL_VERSION,
        },
      },
    };
  }

  if (method === 'ping') {
    return { jsonrpc: '2.0', id, result: {} };
  }

  if (method === 'tools/list') {
    return { jsonrpc: '2.0', id, result: { tools: MCP_TOOLS } };
  }

  if (method === 'tools/call') {
    const toolName = String(params.name ?? '');
    const args = (params.arguments as Record<string, unknown> | undefined) ?? {};

    if (toolName === 'linkedin_query_cache') {
      const sql = String(args.sql ?? '');
      const result = await queryCacheWithFallback(sql, brokerCfg);
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: !result.ok,
        },
      };
    }

    if (toolName === 'linkedin_read_comments') {
      const res = await readLinkedInComments(
        {
          ...(typeof args.postUrn === 'string' ? { postUrn: args.postUrn } : {}),
          ...(typeof args.url === 'string' ? { url: args.url } : {}),
          ...(typeof args.publicId === 'string' ? { publicId: args.publicId } : {}),
          latest: args.latest === true,
        },
        brokerCfg,
      );
      return {
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }], isError: !res.ok },
      };
    }

    const actionMap: Record<string, string> = {
      browser_capabilities: 'browser.capabilities',
      browser_observe: 'browser.observe',
      browser_act: 'browser.act',
      linkedin_status: 'linkedin.status',
      linkedin_search: 'linkedin.search',
      linkedin_get_profile: 'linkedin.profile.get',
      linkedin_get_post: 'linkedin.post.get',
      linkedin_get_company: 'linkedin.company.get',
      linkedin_get_job: 'linkedin.job.get',
      linkedin_read_analytics: 'linkedin.analytics.read',
      linkedin_draft_write: 'linkedin.draft.create',
    };

    let rpcAction = actionMap[toolName];
    if (toolName === 'linkedin_list_inbox') {
      rpcAction = args.threadId ? 'linkedin.inbox.thread' : 'linkedin.inbox.list';
    }

    if (!rpcAction) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Unknown MCP tool: ${toolName}` },
      };
    }

    const fence =
      typeof args.pageId === 'string' && typeof args.epoch === 'number' && typeof args.leaseId === 'string'
        ? {
            tabId: Number(args.tabId ?? 0),
            pageId: args.pageId,
            epoch: args.epoch,
            leaseId: args.leaseId,
          }
        : undefined;

    const rpcRes = await callBrokerRpc(rpcAction, args, {
      ...brokerCfg,
      fence,
    });

    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: [{ type: 'text', text: JSON.stringify(rpcRes, null, 2) }],
        isError: !rpcRes.ok,
      },
    };
  }

  if (id === null) return null;
  return {
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Unsupported MCP method: ${method}` },
  };
}

export function runMcpStdioLoop(brokerCfg: BrokerClientConfig = {}): void {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    void (async () => {
      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        const reply = await handleMcpJsonRpcMessage(parsed, brokerCfg);
        if (reply) {
          process.stdout.write(`${JSON.stringify(reply)}\n`);
        }
      } catch (err) {
        process.stdout.write(
          `${JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: {
              code: -32700,
              message: err instanceof Error ? err.message : String(err),
            },
          })}\n`,
        );
      }
    })();
  });
}
