/**
 * Example data for the demo pages. Replace with your own API calls; every name and figure here is a
 * placeholder.
 */

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
