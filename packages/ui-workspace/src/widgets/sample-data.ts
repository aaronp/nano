/**
 * Example data for the demo pages. Replace with your own API calls; every name and figure here is a
 * placeholder.
 */

export interface Message {
  readonly id: string;
  readonly folder: 'inbox' | 'starred' | 'sent' | 'archive';
  readonly from: string;
  readonly subject: string;
  readonly preview: string;
  /** Pre-formatted for display; the demo never reads a clock. */ readonly when: string;
  readonly unread: boolean;
  readonly body: readonly string[];
}

export const FOLDERS: readonly { readonly id: Message['folder']; readonly label: string }[] = [
  { id: 'inbox', label: 'Inbox' }, { id: 'starred', label: 'Starred' }, { id: 'sent', label: 'Sent' }, { id: 'archive', label: 'Archive' },
];

export const MESSAGES: readonly Message[] = [
  { id: 'm1', folder: 'inbox', from: '[Sender name]', subject: 'Welcome to the app starter', when: '09:12', unread: true,
    preview: 'Drag the dividers between these three panes…',
    body: ['Drag the dividers between these three panes to resize them. Focus a divider and use the arrow keys for small steps (hold Shift for bigger ones), or double-click it to reset.', 'Each split is a <split-pane> element. Nest them to build any grid of resizable columns and rows.'] },
  { id: 'm2', folder: 'inbox', from: '[Team]', subject: 'Weekly report is ready', when: '08:40', unread: true,
    preview: '[Summary of the report goes here.]', body: ['[Summary of the report goes here.]', '[Second paragraph.]'] },
  { id: 'm3', folder: 'inbox', from: '[Customer]', subject: 'Question about my order', when: 'Mon', unread: false,
    preview: '[Message preview.]', body: ['[Message body.]'] },
  { id: 'm4', folder: 'starred', from: '[Colleague]', subject: 'Design review notes', when: 'Fri', unread: false,
    preview: '[Notes preview.]', body: ['[Notes body.]'] },
  { id: 'm5', folder: 'sent', from: 'You', subject: 'Re: Quarterly plan', when: 'Thu', unread: false,
    preview: '[Your reply.]', body: ['[Your reply.]'] },
];

export const STATS: readonly { readonly label: string; readonly unit: string; readonly values: readonly number[] }[] = [
  { label: 'Active users', unit: '', values: [120, 132, 128, 141, 150, 158, 171] },
  { label: 'Orders', unit: '', values: [48, 52, 50, 47, 55, 61, 64] },
  { label: 'Response time', unit: 'ms', values: [310, 290, 305, 280, 270, 262, 255] },
  { label: 'Error rate', unit: '%', values: [1.4, 1.2, 1.3, 1.1, 0.9, 1.0, 0.8] },
];

export const DAYS: readonly string[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const FILES: readonly { readonly path: string; readonly text: string }[] = [
  { path: 'README.md', text: '# [Project]\n\nThis editor page is a vertical split (editor above, console below)\nwith a horizontal split inside the top pane.\n' },
  { path: 'src/main.ts', text: "import './components/app-shell.ts';\n\n// Register your own pages and widgets here.\n" },
  { path: 'src/config.json', text: '{\n  "name": "[project]",\n  "version": "0.1.0"\n}\n' },
];
