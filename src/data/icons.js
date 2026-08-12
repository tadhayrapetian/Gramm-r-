// Line drawings for the picture tasks. Inline SVG so the app stays one download and
// works with no network at all; `currentColor` lets them follow the theme.

const wrap = (body) =>
  `<svg viewBox="0 0 120 90" role="img" aria-hidden="true" fill="none" stroke="currentColor"
        stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS = {
  switch: wrap(`
    <rect x="34" y="12" width="52" height="66" rx="8"/>
    <rect x="48" y="26" width="24" height="38" rx="5"/>
    <path d="M60 26v14"/>
    <path d="M52 45h16"/>`),

  socket: wrap(`
    <rect x="22" y="16" width="76" height="58" rx="10"/>
    <circle cx="48" cy="45" r="6"/>
    <circle cx="72" cy="45" r="6"/>
    <path d="M60 24v6M60 60v6"/>`),

  plug: wrap(`
    <path d="M46 20v14M74 20v14"/>
    <rect x="34" y="34" width="52" height="30" rx="8"/>
    <path d="M60 64v8c0 6-5 10-11 10H22"/>`),

  cable: wrap(`
    <path d="M12 45h44" stroke-width="14" stroke-linecap="round"/>
    <path d="M56 45l22-14 14-3"/>
    <path d="M56 45h24l14 0"/>
    <path d="M56 45l22 14 14 3"/>
    <path d="M92 28h10M94 45h10M92 62h10" stroke-width="5"/>`),

  extension: wrap(`
    <rect x="26" y="26" width="80" height="34" rx="8"/>
    <circle cx="46" cy="43" r="5"/>
    <circle cx="66" cy="43" r="5"/>
    <circle cx="86" cy="43" r="5"/>
    <path d="M26 43H16c-6 0-10 5-10 11v10"/>
    <path d="M2 64h8"/>`),

  fusebox: wrap(`
    <rect x="18" y="14" width="84" height="62" rx="8"/>
    <rect x="30" y="30" width="60" height="30" rx="4"/>
    <path d="M42 30v30M54 30v30M66 30v30M78 30v30"/>
    <path d="M18 22h84"/>`),
};

export function iconMarkup(name) {
  return ICONS[name] || '';
}
