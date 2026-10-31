import type { SVGProps } from 'react'

export type IconName = 'home' | 'book' | 'calendar' | 'download' | 'arrow' | 'left' | 'right' | 'refresh' | 'file' | 'clock' | 'cloud' | 'check' | 'close' | 'search' | 'shield' | 'logout' | 'sparkles' | 'school' | 'external' | 'alert' | 'wifi'

const paths: Record<IconName, string[]> = {
  home: ['m3 10 9-7 9 7','M5 9v11h14V9','M9 20v-7h6v7'],
  book: ['M4 19.5A2.5 2.5 0 016.5 17H20','M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2Z','M8 7h8'],
  calendar: ['M8 2v4','M16 2v4','M3 10h18','M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2Z','M8 14h.01','M12 14h.01','M16 14h.01','M8 18h.01','M12 18h.01'],
  download: ['M12 3v12','m7 10 5 5 5-5','M5 17v4h14v-4'],
  arrow: ['M5 12h14','m13 6 6 6-6 6'],
  left: ['m15 18-6-6 6-6'],
  right: ['m9 18 6-6-6-6'],
  refresh: ['M20 11a8 8 0 00-14.5-4.4L3 9','M3 3v6h6','M4 13a8 8 0 0014.5 4.4L21 15','M15 15h6v6'],
  file: ['M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8Z','M14 2v6h6','M8 13h8','M8 17h6'],
  clock: ['M12 22a10 10 0 100-20 10 10 0 000 20Z','M12 6v6l4 2'],
  cloud: ['M20 17.5a4.5 4.5 0 00-2-8.53 6 6 0 00-11.36 1.66A4 4 0 008 18h11'],
  check: ['M20 6 9 17l-5-5'],
  close: ['M18 6 6 18','M6 6l12 12'],
  search: ['M11 19a8 8 0 110-16 8 8 0 010 16Z','m21 21-4.35-4.35'],
  shield: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z','m9 12 2 2 4-4'],
  logout: ['M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4','m16 17 5-5-5-5','M21 12H9'],
  sparkles: ['m12 3 1.9 5.7L20 11l-6.1 2.3L12 19l-1.9-5.7L4 11l6.1-2.3L12 3Z','M19 18v4','M17 20h4'],
  school: ['m2 10 10-7 10 7','M4 9v12h16V9','M9 21v-7h6v7','M9 9h6'],
  external: ['M14 3h7v7','M10 14 21 3','M21 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h6'],
  alert: ['M12 9v4','M12 17h.01','M10.3 3.8 2.1 18a2 2 0 001.7 3h16.4a2 2 0 001.7-3L13.7 3.8a2 2 0 00-3.4 0Z'],
  wifi: ['M2 9a16 16 0 0120 0','M5 12a11 11 0 0114 0','M8.5 15.5a6 6 0 017 0','M12 19h.01']
}

export function Icon({ name, size = 20, ...props }: SVGProps<SVGSVGElement> & { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.85} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    {paths[name].map((d, i) => <path d={d} key={i}/>)}
  </svg>
}
