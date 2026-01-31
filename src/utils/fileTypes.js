/**
 * File type detection and classification
 */

// File extension to type mapping
const FILE_TYPES = {
  // Markdown
  md: { type: 'markdown', icon: 'markdown', lang: null, binary: false },
  markdown: { type: 'markdown', icon: 'markdown', lang: null, binary: false },

  // Code - Python
  py: { type: 'code', icon: 'python', lang: 'python', binary: false },
  pyw: { type: 'code', icon: 'python', lang: 'python', binary: false },

  // Code - JavaScript/TypeScript
  js: { type: 'code', icon: 'javascript', lang: 'javascript', binary: false },
  mjs: { type: 'code', icon: 'javascript', lang: 'javascript', binary: false },
  cjs: { type: 'code', icon: 'javascript', lang: 'javascript', binary: false },
  ts: { type: 'code', icon: 'typescript', lang: 'typescript', binary: false },
  tsx: { type: 'code', icon: 'react', lang: 'tsx', binary: false },
  jsx: { type: 'code', icon: 'react', lang: 'jsx', binary: false },

  // Code - Web
  html: { type: 'code', icon: 'html', lang: 'html', binary: false },
  htm: { type: 'code', icon: 'html', lang: 'html', binary: false },
  css: { type: 'code', icon: 'css', lang: 'css', binary: false },
  scss: { type: 'code', icon: 'css', lang: 'scss', binary: false },
  less: { type: 'code', icon: 'css', lang: 'less', binary: false },
  vue: { type: 'code', icon: 'vue', lang: 'vue', binary: false },
  svelte: { type: 'code', icon: 'default', lang: 'svelte', binary: false },

  // Data formats
  json: { type: 'code', icon: 'json', lang: 'json', binary: false },
  yaml: { type: 'code', icon: 'yaml', lang: 'yaml', binary: false },
  yml: { type: 'code', icon: 'yaml', lang: 'yaml', binary: false },
  toml: { type: 'code', icon: 'config', lang: 'toml', binary: false },
  xml: { type: 'code', icon: 'default', lang: 'xml', binary: false },

  // Shell/Config
  sh: { type: 'code', icon: 'shell', lang: 'bash', binary: false },
  bash: { type: 'code', icon: 'shell', lang: 'bash', binary: false },
  zsh: { type: 'code', icon: 'shell', lang: 'bash', binary: false },
  fish: { type: 'code', icon: 'shell', lang: 'bash', binary: false },
  env: { type: 'code', icon: 'config', lang: 'bash', binary: false },
  ini: { type: 'code', icon: 'config', lang: 'ini', binary: false },
  conf: { type: 'code', icon: 'config', lang: 'ini', binary: false },

  // Other languages
  go: { type: 'code', icon: 'default', lang: 'go', binary: false },
  rs: { type: 'code', icon: 'default', lang: 'rust', binary: false },
  rb: { type: 'code', icon: 'default', lang: 'ruby', binary: false },
  php: { type: 'code', icon: 'default', lang: 'php', binary: false },
  java: { type: 'code', icon: 'default', lang: 'java', binary: false },
  kt: { type: 'code', icon: 'default', lang: 'kotlin', binary: false },
  swift: { type: 'code', icon: 'default', lang: 'swift', binary: false },
  c: { type: 'code', icon: 'default', lang: 'c', binary: false },
  cpp: { type: 'code', icon: 'default', lang: 'cpp', binary: false },
  h: { type: 'code', icon: 'default', lang: 'c', binary: false },
  cs: { type: 'code', icon: 'default', lang: 'csharp', binary: false },
  sql: { type: 'code', icon: 'database', lang: 'sql', binary: false },

  // Text files
  txt: { type: 'text', icon: 'text', lang: null, binary: false },
  log: { type: 'text', icon: 'text', lang: null, binary: false },
  csv: { type: 'text', icon: 'text', lang: null, binary: false },

  // Images
  png: { type: 'image', icon: 'image', lang: null, binary: true },
  jpg: { type: 'image', icon: 'image', lang: null, binary: true },
  jpeg: { type: 'image', icon: 'image', lang: null, binary: true },
  gif: { type: 'image', icon: 'image', lang: null, binary: true },
  svg: { type: 'image', icon: 'image', lang: null, binary: true },
  webp: { type: 'image', icon: 'image', lang: null, binary: true },
  ico: { type: 'image', icon: 'image', lang: null, binary: true },

  // PDF
  pdf: { type: 'pdf', icon: 'pdf', lang: null, binary: true },

  // Video
  mp4: { type: 'video', icon: 'video', lang: null, binary: true },
  webm: { type: 'video', icon: 'video', lang: null, binary: true },
  mov: { type: 'video', icon: 'video', lang: null, binary: true },
  avi: { type: 'video', icon: 'video', lang: null, binary: true },
  mkv: { type: 'video', icon: 'video', lang: null, binary: true },

  // Audio
  mp3: { type: 'audio', icon: 'audio', lang: null, binary: true },
  wav: { type: 'audio', icon: 'audio', lang: null, binary: true },
  ogg: { type: 'audio', icon: 'audio', lang: null, binary: true },
  m4a: { type: 'audio', icon: 'audio', lang: null, binary: true },
  flac: { type: 'audio', icon: 'audio', lang: null, binary: true },

  // Archives
  zip: { type: 'archive', icon: 'archive', lang: null, binary: true },
  tar: { type: 'archive', icon: 'archive', lang: null, binary: true },
  gz: { type: 'archive', icon: 'archive', lang: null, binary: true },
  rar: { type: 'archive', icon: 'archive', lang: null, binary: true },
  '7z': { type: 'archive', icon: 'archive', lang: null, binary: true },

  // Office
  doc: { type: 'office', icon: 'office', lang: null, binary: true },
  docx: { type: 'office', icon: 'office', lang: null, binary: true },
  xls: { type: 'office', icon: 'office', lang: null, binary: true },
  xlsx: { type: 'office', icon: 'office', lang: null, binary: true },
  ppt: { type: 'office', icon: 'office', lang: null, binary: true },
  pptx: { type: 'office', icon: 'office', lang: null, binary: true },

  // Executables
  exe: { type: 'executable', icon: 'executable', lang: null, binary: true },
  dmg: { type: 'executable', icon: 'executable', lang: null, binary: true },
  app: { type: 'executable', icon: 'executable', lang: null, binary: true },
};

// Special filenames
const SPECIAL_FILES = {
  'Dockerfile': { type: 'code', icon: 'config', lang: 'dockerfile', binary: false },
  'Makefile': { type: 'code', icon: 'config', lang: 'makefile', binary: false },
  '.gitignore': { type: 'code', icon: 'config', lang: 'gitignore', binary: false },
  '.env': { type: 'code', icon: 'config', lang: 'bash', binary: false },
  '.env.local': { type: 'code', icon: 'config', lang: 'bash', binary: false },
  '.env.example': { type: 'code', icon: 'config', lang: 'bash', binary: false },
};

/**
 * Get file type information
 * @param {string} filename - File name or path
 * @returns {Object} File type info { type, icon, lang, binary }
 */
export function getFileType(filename) {
  const basename = filename.split('/').pop();

  // Check special filenames first
  if (SPECIAL_FILES[basename]) {
    return SPECIAL_FILES[basename];
  }

  // Get extension
  const ext = basename.split('.').pop()?.toLowerCase();

  if (ext && FILE_TYPES[ext]) {
    return FILE_TYPES[ext];
  }

  // Default to text file
  return { type: 'text', icon: 'text', lang: null, binary: false };
}

export default { getFileType, FILE_TYPES };
