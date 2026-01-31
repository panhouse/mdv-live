/**
 * File type detection and classification
 */

// Helper functions to reduce repetition
function code(icon, lang) {
  return { type: 'code', icon, lang, binary: false };
}

function binary(type, icon = type) {
  return { type, icon, lang: null, binary: true };
}

const FILE_TYPES = {
  // Markdown
  md: { type: 'markdown', icon: 'markdown', lang: null, binary: false },
  markdown: { type: 'markdown', icon: 'markdown', lang: null, binary: false },

  // Code - Python
  py: code('python', 'python'),
  pyw: code('python', 'python'),

  // Code - JavaScript/TypeScript
  js: code('javascript', 'javascript'),
  mjs: code('javascript', 'javascript'),
  cjs: code('javascript', 'javascript'),
  ts: code('typescript', 'typescript'),
  tsx: code('react', 'tsx'),
  jsx: code('react', 'jsx'),

  // Code - Web
  html: code('html', 'html'),
  htm: code('html', 'html'),
  css: code('css', 'css'),
  scss: code('css', 'scss'),
  less: code('css', 'less'),
  vue: code('vue', 'vue'),
  svelte: code('default', 'svelte'),

  // Data formats
  json: code('json', 'json'),
  yaml: code('yaml', 'yaml'),
  yml: code('yaml', 'yaml'),
  toml: code('config', 'toml'),
  xml: code('default', 'xml'),

  // Shell/Config
  sh: code('shell', 'bash'),
  bash: code('shell', 'bash'),
  zsh: code('shell', 'bash'),
  fish: code('shell', 'bash'),
  env: code('config', 'bash'),
  ini: code('config', 'ini'),
  conf: code('config', 'ini'),

  // Other languages
  go: code('default', 'go'),
  rs: code('default', 'rust'),
  rb: code('default', 'ruby'),
  php: code('default', 'php'),
  java: code('default', 'java'),
  kt: code('default', 'kotlin'),
  swift: code('default', 'swift'),
  c: code('default', 'c'),
  cpp: code('default', 'cpp'),
  h: code('default', 'c'),
  cs: code('default', 'csharp'),
  sql: code('database', 'sql'),

  // Text files
  txt: { type: 'text', icon: 'text', lang: null, binary: false },
  log: { type: 'text', icon: 'text', lang: null, binary: false },
  csv: { type: 'text', icon: 'text', lang: null, binary: false },

  // Images
  png: binary('image'),
  jpg: binary('image'),
  jpeg: binary('image'),
  gif: binary('image'),
  svg: binary('image'),
  webp: binary('image'),
  ico: binary('image'),

  // PDF
  pdf: binary('pdf'),

  // Video
  mp4: binary('video'),
  webm: binary('video'),
  mov: binary('video'),
  avi: binary('video'),
  mkv: binary('video'),

  // Audio
  mp3: binary('audio'),
  wav: binary('audio'),
  ogg: binary('audio'),
  m4a: binary('audio'),
  flac: binary('audio'),

  // Archives
  zip: binary('archive'),
  tar: binary('archive'),
  gz: binary('archive'),
  rar: binary('archive'),
  '7z': binary('archive'),

  // Office
  doc: binary('office'),
  docx: binary('office'),
  xls: binary('office'),
  xlsx: binary('office'),
  ppt: binary('office'),
  pptx: binary('office'),

  // Executables
  exe: binary('executable'),
  dmg: binary('executable'),
  app: binary('executable'),
};

// Special filenames that don't follow extension-based detection
const SPECIAL_FILES = {
  'Dockerfile': code('config', 'dockerfile'),
  'Makefile': code('config', 'makefile'),
  '.gitignore': code('config', 'gitignore'),
  '.env': code('config', 'bash'),
  '.env.local': code('config', 'bash'),
  '.env.example': code('config', 'bash'),
};

const DEFAULT_FILE_TYPE = { type: 'text', icon: 'text', lang: null, binary: false };

/**
 * Get file type information from filename or path
 * @param {string} filename - File name or path
 * @returns {{ type: string, icon: string, lang: string|null, binary: boolean }}
 */
export function getFileType(filename) {
  const basename = filename.split('/').pop() || '';

  // Check special filenames first
  if (SPECIAL_FILES[basename]) {
    return SPECIAL_FILES[basename];
  }

  // Extract extension (last part after dot)
  const lastDotIndex = basename.lastIndexOf('.');
  if (lastDotIndex === -1 || lastDotIndex === basename.length - 1) {
    return DEFAULT_FILE_TYPE;
  }

  const ext = basename.slice(lastDotIndex + 1).toLowerCase();
  return FILE_TYPES[ext] || DEFAULT_FILE_TYPE;
}

export { FILE_TYPES };
