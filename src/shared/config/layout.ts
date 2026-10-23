export const Z_INDEX = {
  base: 0,
  stickyHeader: 10,
  dropdown: 30,
  drawer: 35,
  commandIsland: 40,
  modalBackdrop: 50,
  modalCard: 51,
  popover: 60,
  toast: 100,
} as const

export const LAYOUT_METRICS = {
  sidebarWidthCollapsed: 64,
  sidebarWidthExpanded: 240,
  titlebarHeight: 40,
  commandIslandBottomPadding: 96,
  cardGridMinWidth: 260,
} as const

export const ANIMATION_DURATION = {
  fast: 150,
  normal: 200,
  slow: 300,
  toastAutoDismiss: 3000,
} as const
