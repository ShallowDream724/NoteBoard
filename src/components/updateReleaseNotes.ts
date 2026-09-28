import MarkdownIt from 'markdown-it';

// Release text is remote content. Keep the renderer independent of the editor,
// escape raw HTML, and leave external navigation to the native opener.
const parser = new MarkdownIt({ html: false, linkify: true, breaks: false, typographer: false });
parser.validateLink = href => /^https?:\/\//i.test(href);
parser.renderer.rules.image = (tokens, index) => {
  const label = parser.utils.escapeHtml(tokens[index].content || '图片');
  return `<span class="update-release-image-alt">${label}</span>`;
};

export function renderUpdateReleaseNotes(source: string): string {
  return parser.render(source);
}
