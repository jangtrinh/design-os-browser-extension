export interface FixtureHttpResponse {
  status: number;
  contentType: string;
  body: string;
}

const HASH_SALT = 'a9c4e1f277b0';

export function renderFixtureRoute(pathname: string): FixtureHttpResponse | null {
  if (pathname.startsWith('/fixture/voyager/api/graphql')) {
    return {
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({
        data: { ok: true },
        included: [
          {
            $type: 'com.linkedin.voyager.dash.identity.profile.Profile',
            entityUrn: 'urn:li:fsd_profile:ACoAA_LINH_NGUYEN',
            publicIdentifier: 'linh-nguyen-staff-ai',
            firstName: 'Linh',
            lastName: 'Nguyen',
            headline: 'Staff AI Systems Engineer · Local-First Browser Automation',
            locationName: 'Ho Chi Minh City, Vietnam',
            summary:
              'Designs capability-tiered WebExtensions, fenced dispatchers, and hybrid semantic+passive data readers without fragile API hashes.',
            followersCount: 14820,
            skills: ['TypeScript 7', 'WebExtensions MV3', 'Distributed Systems', 'SQLite'],
          },
          {
            $type: 'com.linkedin.voyager.dash.search.SearchEntity',
            entityUrn: 'urn:li:fsd_profile:ACoAA_MINH_TRAN',
            publicIdentifier: 'minh-tran-product',
            firstName: 'Minh',
            lastName: 'Tran',
            headline: 'Founding PM · Developer Tools',
          },
        ],
      }),
    };
  }

  if (pathname === '/fixture/in/linh-nguyen-staff-ai') {
    return {
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Linh Nguyen | LinkedIn Fixture</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #F4F2EE; color: #1D2226; padding: 24px; }
    main { max-width: 780px; margin: 0 auto; background: #FFFFFF; border: 1px solid #DCD9D2; border-radius: 12px; padding: 24px; }
    h1 { margin: 0 0 6px; font-size: 24px; }
    .meta { color: #52514E; margin: 0 0 12px; }
    .badge { display: inline-block; background: #E8F3FF; color: #0A66C2; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; }
    ul { padding-left: 18px; }
  </style>
</head>
<body>
  <main>
    <span class="badge">Zero-Drift Hybrid Reader Fixture</span>
    <h1 data-test="profile-name">Linh Nguyen</h1>
    <p data-test="profile-headline" class="meta">Staff AI Systems Engineer · Local-First Browser Automation</p>
    <p data-test="profile-location" class="meta">Ho Chi Minh City, Vietnam</p>
    <p data-test="profile-connections" class="meta">500+ connections</p>
    <section>
      <h2>Experience</h2>
      <ul>
        <li data-test="experience-item">
          <strong data-test="experience-title">Staff AI Systems Engineer</strong> ·
          <span data-test="experience-company">DESIGN:OS Labs</span>
          <span data-test="experience-dates">2024 - Present</span>
        </li>
      </ul>
    </section>
    <section>
      <h2>Skills</h2>
      <span data-test="skill-pill">WebExtensions</span>
    </section>
  </main>
  <script>
    const rotatedHash = 'voyagerIdentityDashProfiles.' + Math.random().toString(16).slice(2, 10) + '${HASH_SALT}';
    window.__passiveProbeDone = fetch('/fixture/voyager/api/graphql?queryId=' + rotatedHash)
      .then((r) => r.json());
  </script>
</body>
</html>`,
    };
  }

  if (pathname === '/fixture/search/results/people') {
    return {
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Search People AI | LinkedIn Fixture</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #F4F2EE; color: #1D2226; padding: 24px; }
    main { max-width: 780px; margin: 0 auto; background: #FFFFFF; border: 1px solid #DCD9D2; border-radius: 12px; padding: 20px; }
    li { list-style: none; padding: 12px 0; border-top: 1px solid #E5E3DD; }
    li:first-child { border-top: none; }
  </style>
</head>
<body>
  <main>
    <h1>Search results for "AI"</h1>
    <ul>
      <li data-test="search-result">
        <a href="/fixture/in/linh-nguyen-staff-ai" data-test="result-title">Linh Nguyen</a>
        <div data-test="result-subtitle">Staff AI Systems Engineer · Local-First Browser Automation</div>
        <div data-test="result-secondary">Ho Chi Minh City</div>
      </li>
      <li data-test="search-result">
        <a href="/fixture/in/minh-tran-product" data-test="result-title">Minh Tran</a>
        <div data-test="result-subtitle">Founding PM · Developer Tools</div>
        <div data-test="result-secondary">Singapore</div>
      </li>
    </ul>
  </main>
  <script>
    window.__searchProbeDone = fetch('/fixture/voyager/api/graphql?queryId=voyagerSearchDashClusters.rotated9988').then((r) => r.json());
  </script>
</body>
</html>`,
    };
  }

  if (pathname === '/fixture/messaging/thread/42') {
    return {
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Messaging · Linh Nguyen | LinkedIn Fixture</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #F4F2EE; color: #1D2226; padding: 24px; }
    main { max-width: 720px; margin: 0 auto; background: #FFFFFF; border: 1px solid #DCD9D2; border-radius: 12px; padding: 20px; display: flex; flex-direction: column; gap: 12px; }
    textarea { width: 100%; min-height: 96px; padding: 10px; font-size: 15px; border: 2px solid #0A66C2; border-radius: 8px; }
    .actions { display: flex; justify-content: space-between; align-items: center; }
    button { min-height: 40px; padding: 8px 16px; border-radius: 8px; border: none; background: #0A66C2; color: #FFFFFF; font-weight: 600; }
    .notice { background: #E8F5EE; color: #125E3A; padding: 8px 12px; border-radius: 8px; font-size: 13px; }
  </style>
</head>
<body>
  <main>
    <h1 data-test="thread-header">Linh Nguyen</h1>
    <div data-test="thread-message">
      <strong data-test="message-sender">Linh Nguyen</strong>
      <p data-test="message-body">Happy to compare extension bridge architectures this week.</p>
    </div>
    <div class="notice">Copilot Guard: Send button click counter = <span id="send-clicks">0</span></div>
    <label for="composer">Reply Draft Composer</label>
    <textarea id="composer" name="message" data-test-composer-input="true" placeholder="Write a message..."></textarea>
    <div class="actions">
      <span id="draft-status">Awaiting human Send click</span>
      <button id="send-btn" type="button">Send</button>
    </div>
  </main>
  <script>
    window.__sendClickCount = 0;
    document.getElementById('send-btn').addEventListener('click', () => {
      window.__sendClickCount += 1;
      document.getElementById('send-clicks').textContent = String(window.__sendClickCount);
    });
  </script>
</body>
</html>`,
    };
  }

  if (pathname === '/fixture/checkpoint/challenge') {
    return {
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Security Verification | LinkedIn Fixture</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #FCECE9; color: #9E1F15; padding: 24px; }
    main { max-width: 560px; margin: 0 auto; background: #FFFFFF; border: 1px solid #F2C4BF; border-radius: 12px; padding: 24px; }
  </style>
</head>
<body>
  <main data-test-id="checkpoint-challenge">
    <h1>Let's do a quick security verification</h1>
    <p>Unusual activity check triggered. Human completion required in the visible tab.</p>
  </main>
</body>
</html>`,
    };
  }

  return null;
}
