/** Builds hostile inputs in memory for the hardening tests: nothing here is a real document. */
/** A one-page text PDF with n separate pieces of text, written by hand (Helvetica needs no embedded font). */
export const manyPiecesPdf = (n: number): Uint8Array => {
  const ops: string[] = ["BT /F1 4 Tf"];
  for (let i = 0; i < n; i++) ops.push(`1 0 0 1 ${(i % 50) * 11} ${800 - Math.floor(i / 50) % 790} Tm (x) Tj`);
  ops.push("ET");
  const stream = ops.join("\n");
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 820] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>", `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  let out = "%PDF-1.4\n"; const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return new TextEncoder().encode(out);
};
