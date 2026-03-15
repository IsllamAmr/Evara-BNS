const QRCode = require('qrcode');

/**
 * Generate a QR code as a data URL (base64 PNG)
 * @param {string} data - The content to encode in the QR
 * @returns {Promise<string>} - Base64 data URL
 */
const generateQR = async (data, options = {}) => {
  const defaultOptions = {
    type: 'image/png',
    quality: 0.92,
    margin: 1,
    width: 300,
    color: {
      dark: '#1a1a2e',   // Dark navy for QR dots
      light: '#ffffff',  // White background
    },
    errorCorrectionLevel: 'H',
    ...options,
  };

  const dataUrl = await QRCode.toDataURL(data, defaultOptions);
  return dataUrl;
};

/**
 * Generate a QR code as SVG string
 * @param {string} data
 * @returns {Promise<string>} SVG string
 */
const generateQRSVG = async (data) => {
  const svg = await QRCode.toString(data, {
    type: 'svg',
    margin: 1,
    color: {
      dark: '#1a1a2e',
      light: '#ffffff',
    },
    errorCorrectionLevel: 'H',
  });
  return svg;
};

/**
 * Generate a QR code as Buffer (for file saving)
 * @param {string} data
 * @returns {Promise<Buffer>}
 */
const generateQRBuffer = async (data) => {
  const buffer = await QRCode.toBuffer(data, {
    type: 'png',
    margin: 1,
    width: 512,
    errorCorrectionLevel: 'H',
  });
  return buffer;
};

module.exports = { generateQR, generateQRSVG, generateQRBuffer };
