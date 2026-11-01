// Stroke icons for navigation (24px grid).
const I = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
export const IconGame = () => <I d="M5 4h14v16H5zM9 9h6M9 13h6M9 17h3" />;
export const IconPairings = () => <I d="M4 6h3M4 12h3M4 18h3M10 6h10M10 12h10M10 18h10" />;
/** Two pairs feeding a final. */
export const IconBracket = () => <I d="M3 5h5v4H3M3 15h5v4H3M8 7h3v10H8M11 12h4M15 9h6v6h-6z" />;
export const IconStandings = () => <I d="M4 20V11h4v9M10 20V5h4v15M16 20v-6h4v6M3 20h18" />;
export const IconPlayers = () => <I d="M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c.6-3.4 3.2-5.5 6.5-5.5s5.9 2.1 6.5 5.5M16 4.5a3.2 3.2 0 0 1 0 6.3M18.5 14.8c1.7.7 2.8 2.4 3 5.2" />;
export const IconDesk = () => <I d="M8 4h8v3H8zM6 5.5H4.5V21h15V5.5H18M8 12l2.2 2.2L16 9.5" />;
export const IconSettings = () => <I d="M4 7h10M18 7h2M4 17h4M12 17h8M14 4.5v5M8 14.5v5" />;
export const IconLog = () => <I d="M12 7v5l3 2M21 12a9 9 0 1 1-9-9 9 9 0 0 1 9 9z" />;
