// Gera os cartões de atividade do perfil (SVG, tema claro e escuro).
// Roda no GitHub Actions todo dia: node scripts/stats.mjs <pasta-de-saída>
// Usa só a API do GitHub (GraphQL) com o GITHUB_TOKEN do próprio Actions. Sem dependências.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const USER = process.env.GH_USER || 'marlonrodler';
const OUT = process.argv[2] || 'dist';

// ---------- Dados ----------
const QUERY = `query($login: String!) {
  user(login: $login) {
    createdAt
    followers { totalCount }
    repositories(ownerAffiliations: OWNER, privacy: PUBLIC, isFork: false, first: 100) {
      totalCount
      nodes {
        stargazerCount
        languages(first: 10, orderBy: { field: SIZE, direction: DESC }) { edges { size node { name color } } }
      }
    }
    contributionsCollection {
      totalCommitContributions
      totalPullRequestContributions
      totalIssueContributions
      restrictedContributionsCount
      contributionCalendar { totalContributions weeks { contributionDays { contributionCount } } }
    }
  }
}`;

export async function fetchStats(token, login = USER) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': `${login}-profile-stats` },
    body: JSON.stringify({ query: QUERY, variables: { login } }),
  });
  if (!res.ok) throw new Error(`GitHub respondeu ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(json.errors.map((e) => e.message).join('; '));
  return summarize(json.data.user);
}

export function summarize(u) {
  const c = u.contributionsCollection;
  const langs = new Map();
  let stars = 0;
  for (const r of u.repositories.nodes) {
    stars += r.stargazerCount;
    for (const { size, node } of r.languages.edges) {
      const cur = langs.get(node.name) || { name: node.name, color: node.color || '#8b949e', size: 0 };
      cur.size += size;
      langs.set(node.name, cur);
    }
  }
  const total = [...langs.values()].reduce((a, l) => a + l.size, 0) || 1;
  const sorted = [...langs.values()].sort((a, b) => b.size - a.size);
  const top = sorted.slice(0, 6).map((l) => ({ ...l, pct: (l.size / total) * 100 }));
  const rest = sorted.slice(6).reduce((a, l) => a + l.size, 0);
  if (rest > 0) top.push({ name: 'Outras', color: '#8b949e', pct: (rest / total) * 100 });
  const weeks = c.contributionCalendar.weeks.map((w) => w.contributionDays.reduce((a, d) => a + d.contributionCount, 0));
  return {
    contributions: c.contributionCalendar.totalContributions,
    commits: c.totalCommitContributions + c.restrictedContributionsCount,
    prs: c.totalPullRequestContributions,
    issues: c.totalIssueContributions,
    repos: u.repositories.totalCount,
    stars,
    followers: u.followers.totalCount,
    since: new Date(u.createdAt).getFullYear(),
    weeks: weeks.slice(-26),
    languages: top,
  };
}

// ---------- Desenho ----------
const THEMES = {
  light: { bg: '#ffffff', border: '#d0d7de', title: '#1f2328', text: '#59636e', value: '#1f2328', bar: '#0969da', barDim: '#ddf4ff', track: '#eff2f5' },
  dark: { bg: '#0d1117', border: '#30363d', title: '#e6edf3', text: '#9198a1', value: '#f0f6fc', bar: '#4493f8', barDim: '#1f2a3a', track: '#21262d' },
};
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif";
const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const fmt = (n) => new Intl.NumberFormat('pt-BR').format(n);

const frame = (w, h, t, body, label) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">
<style>
  text { font-family: ${FONT}; }
  .t { font-size: 15px; font-weight: 600; fill: ${t.title}; }
  .l { font-size: 12.5px; fill: ${t.text}; }
  .v { font-size: 20px; font-weight: 700; fill: ${t.value}; font-variant-numeric: tabular-nums; }
  .s { font-size: 11px; fill: ${t.text}; }
  .grow { transform-box: fill-box; transform-origin: bottom; animation: grow 700ms cubic-bezier(.2,.8,.2,1) both; }
  .fade { animation: fade 600ms ease-out both; }
  @keyframes grow { from { transform: scaleY(0); } }
  @keyframes fade { from { opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { .grow, .fade { animation: none; } }
</style>
<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="12" fill="${t.bg}" stroke="${t.border}"/>
${body}
</svg>`;

export function statsCard(d, theme = 'light') {
  const t = THEMES[theme];
  const W = 460, H = 200;
  const items = [
    ['Contribuições', d.contributions],
    ['Commits', d.commits],
    ['Pull requests', d.prs],
    ['Repositórios públicos', d.repos],
  ];
  const grid = items
    .map(([label, value], i) => {
      const x = 24 + (i % 2) * 140, y = 74 + Math.floor(i / 2) * 52;
      return `<g class="fade" style="animation-delay:${i * 80}ms"><text class="v" x="${x}" y="${y}">${fmt(value)}</text><text class="l" x="${x}" y="${y + 18}">${esc(label)}</text></g>`;
    })
    .join('');
  // Barras: contribuições por semana nas últimas 26 semanas
  const max = Math.max(1, ...d.weeks);
  const bx = 330, bw = 106, bh = 92, by = 150, n = d.weeks.length || 1, gap = 1.2, cw = (bw - gap * (n - 1)) / n;
  const bars = d.weeks
    .map((v, i) => {
      const h = Math.max(2, (v / max) * bh);
      return `<rect class="grow" style="animation-delay:${200 + i * 15}ms" x="${(bx + i * (cw + gap)).toFixed(2)}" y="${(by - h).toFixed(2)}" width="${cw.toFixed(2)}" height="${h.toFixed(2)}" rx="1" fill="${v ? t.bar : t.barDim}"/>`;
    })
    .join('');
  const body = `<text class="t" x="24" y="34">Atividade no GitHub</text>
<text class="s" x="${W - 24}" y="34" text-anchor="end">últimos 12 meses</text>
${grid}
<rect x="${bx - 8}" y="52" width="${bw + 16}" height="120" rx="8" fill="${t.track}"/>
${bars}
<text class="s" x="${bx + bw / 2}" y="166" text-anchor="middle">6 meses, por semana</text>
<text class="s" x="24" y="${H - 18}">No GitHub desde ${d.since} · atualizado todo dia</text>`;
  return frame(W, H, t, body, `Atividade no GitHub: ${d.contributions} contribuições e ${d.commits} commits no último ano, ${d.repos} repositórios públicos`);
}

export function languagesCard(d, theme = 'light') {
  const t = THEMES[theme];
  const W = 360, H = 200;
  const langs = d.languages;
  let x = 24;
  const barW = W - 48;
  const segs = langs
    .map((l) => {
      const w = Math.max(2, (l.pct / 100) * barW);
      const r = `<rect x="${x.toFixed(2)}" y="52" width="${w.toFixed(2)}" height="10" fill="${l.color}"/>`;
      x += w;
      return r;
    })
    .join('');
  const legend = langs
    .map((l, i) => {
      const cx = 24 + (i % 2) * 160, cy = 92 + Math.floor(i / 2) * 26;
      return `<g class="fade" style="animation-delay:${i * 60}ms"><circle cx="${cx + 5}" cy="${cy - 4}" r="5" fill="${l.color}"/><text class="l" x="${cx + 16}" y="${cy}"><tspan fill="${t.value}" font-weight="600">${esc(l.name)}</tspan>  ${l.pct.toFixed(1).replace('.', ',')}%</text></g>`;
    })
    .join('');
  const body = `<text class="t" x="24" y="34">Linguagens mais usadas</text>
<clipPath id="bar"><rect x="24" y="52" width="${barW}" height="10" rx="5"/></clipPath>
<g clip-path="url(#bar)">${segs}</g>
${legend}`;
  return frame(W, H, t, body, `Linguagens mais usadas: ${langs.map((l) => `${l.name} ${l.pct.toFixed(0)}%`).join(', ')}`);
}

export function writeCards(d, dir = OUT) {
  mkdirSync(dir, { recursive: true });
  for (const theme of ['light', 'dark']) {
    writeFileSync(join(dir, `stats-${theme}.svg`), statsCard(d, theme));
    writeFileSync(join(dir, `languages-${theme}.svg`), languagesCard(d, theme));
  }
  writeFileSync(join(dir, 'stats.json'), JSON.stringify({ ...d, updatedAt: new Date().toISOString() }, null, 2));
}

// Execução direta
if (import.meta.url === `file://${process.argv[1]}`) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('Defina GITHUB_TOKEN para buscar os dados.');
    process.exit(1);
  }
  const d = await fetchStats(token);
  writeCards(d);
  console.log(`Cartões gerados em ${OUT}:`, { contribuições: d.contributions, commits: d.commits, repositórios: d.repos });
}
