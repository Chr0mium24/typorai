import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

const baseProps = {
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  strokeWidth: 1.8,
  viewBox: '0 0 24 24',
};

export const MenuIcon = (props: IconProps) => (
  <svg aria-hidden="true" {...baseProps} {...props}>
    <path d="M4 7h16" />
    <path d="M4 12h16" />
    <path d="M4 17h16" />
  </svg>
);

export const PanelLeftCloseIcon = (props: IconProps) => (
  <svg aria-hidden="true" {...baseProps} {...props}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16" />
    <path d="m15 9-3 3 3 3" />
  </svg>
);

export const PanelLeftOpenIcon = (props: IconProps) => (
  <svg aria-hidden="true" {...baseProps} {...props}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16" />
    <path d="m12 9 3 3-3 3" />
  </svg>
);

export const FilePlusIcon = (props: IconProps) => (
  <svg aria-hidden="true" {...baseProps} {...props}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
    <path d="M12 11v6" />
    <path d="M9 14h6" />
  </svg>
);

export const FolderPlusIcon = (props: IconProps) => (
  <svg aria-hidden="true" {...baseProps} {...props}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <path d="M12 11v5" />
    <path d="M9.5 13.5h5" />
  </svg>
);

export const SettingsIcon = (props: IconProps) => (
  <svg aria-hidden="true" {...baseProps} {...props}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.2.49.73.82 1.26.82H21a2 2 0 1 1 0 4h-.34c-.53 0-1.06.33-1.26.82z" />
  </svg>
);

export const RefreshIcon = (props: IconProps) => (
  <svg aria-hidden="true" {...baseProps} {...props}>
    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
    <path d="M21 3v6h-6" />
  </svg>
);

export const CodeIcon = (props: IconProps) => (
  <svg aria-hidden="true" {...baseProps} {...props}>
    <path d="m8 9-4 3 4 3" />
    <path d="m16 9 4 3-4 3" />
    <path d="m14 5-4 14" />
  </svg>
);

export const TrashIcon = (props: IconProps) => (
  <svg aria-hidden="true" {...baseProps} {...props}>
    <path d="M3 6h18" />
    <path d="M8 6V4h8v2" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
  </svg>
);

export const ChevronRightIcon = (props: IconProps) => (
  <svg aria-hidden="true" {...baseProps} {...props}>
    <path d="m9 18 6-6-6-6" />
  </svg>
);

export const FolderIcon = (props: IconProps) => (
  <svg aria-hidden="true" {...baseProps} {...props}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
);

export const FileTextIcon = (props: IconProps) => (
  <svg aria-hidden="true" {...baseProps} {...props}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
    <path d="M9 13h6" />
    <path d="M9 17h6" />
  </svg>
);
