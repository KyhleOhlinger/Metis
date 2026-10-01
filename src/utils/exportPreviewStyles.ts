/** Export-only rules; Visual prose styles come from loaded `index.css`. */
export const EXPORT_CHAPTER_CSS = `
.export-chapter-break {
  break-before: page;
  page-break-before: always;
}
.export-chapter-title {
  font-size: 0.72em;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin: 0 0 0.75em;
  padding-bottom: 0.35em;
  border-bottom: 1px solid currentColor;
  opacity: 0.45;
}
.export-supernote-pages img {
  display: block;
  width: 100%;
  max-width: 100%;
  height: auto;
  margin: 0 0 12px;
  page-break-inside: avoid;
  break-inside: avoid;
}
.html2pdf__page-break {
  display: block;
  height: 0;
  page-break-after: always;
  break-after: page;
}
`;

