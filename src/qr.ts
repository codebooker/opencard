import QRCode from "qrcode";

export async function qrPng(url: string, color = "#111827"): Promise<Buffer> {
  return QRCode.toBuffer(url, {
    type: "png",
    width: 600,
    margin: 2,
    color: { dark: color, light: "#ffffff" },
    errorCorrectionLevel: "M",
  });
}

export async function qrDataUrl(url: string, color = "#111827"): Promise<string> {
  return QRCode.toDataURL(url, {
    width: 240,
    margin: 1,
    color: { dark: color, light: "#ffffff" },
  });
}
