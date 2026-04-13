/**
 * Lightweight PDF text extractor.
 *
 * Scans the raw PDF byte stream for BT/ET (Begin Text / End Text) blocks and
 * decodes the text strings found inside them. Supports:
 *   - ASCII / Latin-1 literal strings
 *   - UTF-16BE literal and hex strings (BOM FEFF — common in modern PDFs)
 *   - Windows-1251 single-byte Cyrillic encoding
 *   - Octal and common backslash escapes
 *
 * Limitations (require a full PDF library like PDF.js to resolve):
 *   - Custom ToUnicode CMap tables (arbitrary glyph ID → Unicode mappings)
 *   - FlateDecode / compressed content streams
 */

(function () {
	/**
	 * Windows-1251 to Unicode mapping for bytes 0x80–0xFF.
	 * Bytes 0x00–0x7F are identical to ASCII/Unicode, so they are not included.
	 */
	var CP1251 = [
		0x0402, 0x0403, 0x201A, 0x0453, 0x201E, 0x2026, 0x2020, 0x2021,
		0x20AC, 0x2030, 0x0409, 0x2039, 0x040A, 0x040C, 0x040B, 0x040F,
		0x0452, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014,
		0xFFFD, 0x2122, 0x0459, 0x203A, 0x045A, 0x045C, 0x045B, 0x045F,
		0x00A0, 0x040E, 0x045E, 0x0408, 0x00A4, 0x0490, 0x00A6, 0x00A7,
		0x0401, 0x00A9, 0x0404, 0x00AB, 0x00AC, 0x00AD, 0x00AE, 0x0407,
		0x00B0, 0x00B1, 0x0406, 0x0456, 0x0491, 0x00B5, 0x00B6, 0x00B7,
		0x0451, 0x2116, 0x0454, 0x00BB, 0x0458, 0x0405, 0x0455, 0x0457,
		0x0410, 0x0411, 0x0412, 0x0413, 0x0414, 0x0415, 0x0416, 0x0417,
		0x0418, 0x0419, 0x041A, 0x041B, 0x041C, 0x041D, 0x041E, 0x041F,
		0x0420, 0x0421, 0x0422, 0x0423, 0x0424, 0x0425, 0x0426, 0x0427,
		0x0428, 0x0429, 0x042A, 0x042B, 0x042C, 0x042D, 0x042E, 0x042F,
		0x0430, 0x0431, 0x0432, 0x0433, 0x0434, 0x0435, 0x0436, 0x0437,
		0x0438, 0x0439, 0x043A, 0x043B, 0x043C, 0x043D, 0x043E, 0x043F,
		0x0440, 0x0441, 0x0442, 0x0443, 0x0444, 0x0445, 0x0446, 0x0447,
		0x0448, 0x0449, 0x044A, 0x044B, 0x044C, 0x044D, 0x044E, 0x044F,
	];

	/**
	 * Return true when at least 1/3 of the non-ASCII bytes in a Latin-1
	 * decoded string fall in the Cyrillic range of CP1251 (0xC0–0xFF = А–я).
	 * This heuristic distinguishes CP1251 Cyrillic from other 8-bit encodings.
	 * @param {string} latin1 - Latin-1 decoded string.
	 * @returns {boolean}
	 */
	function looksLikeCp1251(latin1) {
		var highBytes = 0;
		var cyrillicBytes = 0;
		for (var i = 0; i < latin1.length; i++) {
			var c = latin1.charCodeAt(i);
			if (c >= 0x80) {
				highBytes++;
				if (c >= 0xC0) cyrillicBytes++;
			}
		}
		return highBytes > 0 && cyrillicBytes / highBytes >= 0.33;
	}

	/**
	 * Re-encode a Latin-1 decoded string as CP1251 Unicode.
	 * @param {string} latin1
	 * @returns {string}
	 */
	function decodeCp1251(latin1) {
		var result = '';
		for (var i = 0; i < latin1.length; i++) {
			var b = latin1.charCodeAt(i);
			if (b < 0x80) {
				result += latin1[i];
			} else {
				var mapped = CP1251[b - 0x80];
				result += mapped !== undefined ? String.fromCharCode(mapped) : latin1[i];
			}
		}
		return result;
	}

	/**
	 * Decode a UTF-16BE byte sequence from a hex string (without BOM).
	 * Ignores code points ≤ 31 (control characters).
	 * @param {string} hex
	 * @returns {string}
	 */
	function decodeUtf16BeHex(hex) {
		var result = '';
		var padded = hex.length % 4 !== 0 ? hex + '0'.repeat(4 - (hex.length % 4)) : hex;
		for (var i = 0; i + 3 < padded.length; i += 4) {
			var code = parseInt(padded.substr(i, 4), 16);
			if (code > 31) result += String.fromCharCode(code);
		}
		return result;
	}

	/**
	 * Decode a UTF-16BE literal string already loaded as Latin-1 bytes.
	 * The BOM bytes (\xFE\xFF) should be stripped before calling.
	 * @param {string} latin1
	 * @returns {string}
	 */
	function decodeUtf16BeLiteral(latin1) {
		var result = '';
		for (var i = 0; i + 1 < latin1.length; i += 2) {
			var code = (latin1.charCodeAt(i) << 8) | latin1.charCodeAt(i + 1);
			if (code > 31) result += String.fromCharCode(code);
		}
		return result;
	}

	/**
	 * Unescape a PDF literal string (non-UTF-16):
	 *   \\  → \
	 *   \n  → newline
	 *   \r  → carriage return
	 *   \t  → tab
	 *   \(  → (
	 *   \)  → )
	 *   \NNN → octal code point
	 * @param {string} raw
	 * @returns {string}
	 */
	function unescapePdfString(raw) {
		return raw.replace(/\\([\\nrtbfv()']|[0-7]{3})/g, function (_, seq) {
			switch (seq[0]) {
				case 'n': return '\n';
				case 'r': return '\r';
				case 't': return '\t';
				case 'b': return '\b';
				case 'f': return '\f';
				case 'v': return '\v';
				case '\\': return '\\';
				case '(': return '(';
				case ')': return ')';
				default:
					return String.fromCharCode(parseInt(seq, 8));
			}
		});
	}

	/**
	 * Decode a PDF literal string. Handles:
	 *  - UTF-16BE (BOM \xFE\xFF detected after Latin-1 byte decoding)
	 *  - CP1251 Cyrillic (heuristic detection)
	 *  - ASCII / PDFDocEncoding (default)
	 * @param {string} raw - Raw literal content (between outer parentheses, Latin-1 decoded).
	 * @returns {string}
	 */
	function decodeLiteralString(raw) {
		var unescaped = unescapePdfString(raw);
		if (unescaped.length >= 2 &&
			unescaped.charCodeAt(0) === 0xFE &&
			unescaped.charCodeAt(1) === 0xFF) {
			return decodeUtf16BeLiteral(unescaped.substring(2));
		}
		if (looksLikeCp1251(unescaped)) {
			return decodeCp1251(unescaped);
		}
		return unescaped;
	}

	/**
	 * Decode a PDF hex string. Handles:
	 *  - UTF-16BE (BOM FEFF)
	 *  - Single-byte values > 31 (ASCII / Latin-1)
	 * @param {string} hex
	 * @returns {string}
	 */
	function decodeHexString(hex) {
		var padded = hex.length % 2 !== 0 ? hex + '0' : hex;
		if (padded.length >= 4 &&
			padded.substring(0, 4).toUpperCase() === 'FEFF') {
			return decodeUtf16BeHex(padded.substring(4));
		}
		// Check for UTF-16BE without BOM: if all even-indexed bytes are 00 or 04
		// and the string length is a multiple of 4, it is likely UTF-16BE.
		if (padded.length >= 4 && padded.length % 4 === 0) {
			var highZeroCount = 0;
			for (var k = 0; k + 3 < padded.length; k += 4) {
				var highByte = parseInt(padded.substr(k, 2), 16);
				if (highByte === 0x00 || highByte === 0x04) highZeroCount++;
			}
			if (highZeroCount === padded.length / 4) {
				return decodeUtf16BeHex(padded);
			}
		}
		var result = '';
		for (var i = 0; i < padded.length; i += 2) {
			var code = parseInt(padded.substr(i, 2), 16);
			if (code > 31) result += String.fromCharCode(code);
		}
		return result;
	}

	/**
	 * Extract all human-readable text from a PDF ArrayBuffer.
	 *
	 * @param {ArrayBuffer} arrayBuffer - Raw bytes of the PDF file.
	 * @returns {string} Concatenated text content, or '' if parsing fails.
	 */
	function extractPdfText(arrayBuffer) {
		try {
			if (!arrayBuffer || arrayBuffer.byteLength === 0) return '';

			var bytes = new Uint8Array(arrayBuffer);
			var str = '';
			for (var i = 0; i < bytes.length; i++) {
				str += String.fromCharCode(bytes[i]);
			}

			if (str.indexOf('%PDF') !== 0) return '';

			var texts = [];

			var btEtRegex = /BT\s([\s\S]*?)\sET/g;
			var blockMatch;
			while ((blockMatch = btEtRegex.exec(str)) !== null) {
				var block = blockMatch[1];

				// Literal strings: (content) Tj  or  (content) TJ
				// [^)\\]* allows any char except ) and \
				// (?:\\.[^)\\]*)* allows \-escaped sequences inside
				var literalRegex = /\(([^)\\]*(?:\\.[^)\\]*)*)\)\s*TJ?/g;
				var litMatch;
				while ((litMatch = literalRegex.exec(block)) !== null) {
					var text = decodeLiteralString(litMatch[1]);
					var trimmed = text.replace(/\s+/g, ' ').trim();
					if (trimmed) texts.push(trimmed);
				}

				// Hex strings: <hexcode> Tj  or  <hexcode> TJ
				var hexRegex = /<([0-9A-Fa-f]+)>\s*TJ?/g;
				var hexMatch;
				while ((hexMatch = hexRegex.exec(block)) !== null) {
					var decoded = decodeHexString(hexMatch[1]);
					var trimmedHex = decoded.replace(/\s+/g, ' ').trim();
					if (trimmedHex) texts.push(trimmedHex);
				}
			}

			return texts.join(' ').replace(/\s+/g, ' ').trim();
		} catch (_err) {
			return '';
		}
	}

	if (typeof window !== 'undefined') {
		window.extractPdfText = extractPdfText;
	}

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = { extractPdfText: extractPdfText };
	}
})();
