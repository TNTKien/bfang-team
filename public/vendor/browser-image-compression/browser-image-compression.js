(function () {
  if (typeof window === "undefined") return;
  if (typeof window.imageCompression === "function") return;

  function clampQuality(value, fallback) {
    var numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0 || numeric > 1) return fallback;
    return numeric;
  }

  function normalizeType(value, fallback) {
    var type = (value == null ? "" : String(value)).trim().toLowerCase();
    if (!type) return fallback;
    if (type.indexOf("image/") !== 0) return fallback;
    return type;
  }

  function extensionFromType(type) {
    if (type === "image/jpeg") return ".jpg";
    if (type === "image/png") return ".png";
    if (type === "image/webp") return ".webp";
    if (type === "image/bmp") return ".bmp";
    return ".webp";
  }

  function toOutputName(inputName, type) {
    var baseName = (inputName == null ? "" : String(inputName)).trim();
    if (!baseName) baseName = "image";
    var dotIndex = baseName.lastIndexOf(".");
    var stem = dotIndex > 0 ? baseName.slice(0, dotIndex) : baseName;
    stem = stem
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+/, "")
      .replace(/-+$/, "");
    if (!stem) stem = "image";
    return stem + extensionFromType(type);
  }

  function loadImageFromBlob(blob) {
    return new Promise(function (resolve, reject) {
      var objectUrl = URL.createObjectURL(blob);
      var image = new Image();

      image.onload = function () {
        URL.revokeObjectURL(objectUrl);
        resolve(image);
      };

      image.onerror = function () {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("Cannot decode image file."));
      };

      image.src = objectUrl;
    });
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(
        function (blob) {
          if (!blob) {
            reject(new Error("Cannot encode image."));
            return;
          }
          resolve(blob);
        },
        type,
        quality
      );
    });
  }

  function toFile(blob, fileName) {
    if (typeof File === "function") {
      return new File([blob], fileName, {
        type: blob.type,
        lastModified: Date.now()
      });
    }
    try {
      blob.name = fileName;
    } catch (_err) {
      // ignore
    }
    return blob;
  }

  async function imageCompression(file, options) {
    if (!(file instanceof Blob)) {
      throw new Error("Invalid image file.");
    }

    var opts = options || {};
    var targetType = normalizeType(opts.fileType, normalizeType(file.type, "image/webp"));
    var quality = clampQuality(opts.initialQuality, 0.9);
    var maxDimension = Number(opts.maxWidthOrHeight);
    if (!Number.isFinite(maxDimension) || maxDimension <= 0) {
      maxDimension = 0;
    }

    var image = await loadImageFromBlob(file);
    var width = Number(image.naturalWidth || image.width || 0);
    var height = Number(image.naturalHeight || image.height || 0);
    if (!width || !height) {
      throw new Error("Invalid image dimensions.");
    }

    if (maxDimension > 0) {
      const largest = Math.max(width, height);
      if (largest > maxDimension) {
        const ratio = maxDimension / largest;
        width = Math.max(1, Math.round(width * ratio));
        height = Math.max(1, Math.round(height * ratio));
      }
    }

    var canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    var context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas context unavailable.");
    }
    context.drawImage(image, 0, 0, width, height);

    var blob = await canvasToBlob(canvas, targetType, quality);
    var outputName = toOutputName(file && file.name ? file.name : "image", targetType);
    return toFile(blob, outputName);
  }

  window.imageCompression = imageCompression;
})();
