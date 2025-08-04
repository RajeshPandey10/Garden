import cloudinary from "../config/cloudinary.js";

/**
 * Upload image to cloudinary
 * @param {Buffer} fileBuffer - Image buffer
 * @param {string} folder - Cloudinary folder name
 * @param {string} fileName - Optional file name
 * @returns {Promise<Object>} - Cloudinary upload result
 */
export const uploadToCloudinary = async (
  fileBuffer,
  folder = "garden",
  fileName = null
) => {
  return new Promise((resolve, reject) => {
    const uploadOptions = {
      folder: folder,
      resource_type: "image",
      format: "webp",
      quality: "auto",
      fetch_format: "auto",
    };

    if (fileName) {
      uploadOptions.public_id = fileName;
    }

    cloudinary.uploader
      .upload_stream(uploadOptions, (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve({
            public_id: result.public_id,
            url: result.secure_url,
          });
        }
      })
      .end(fileBuffer);
  });
};

/**
 * Delete image from cloudinary
 * @param {string} publicId - Cloudinary public ID
 * @returns {Promise<Object>} - Cloudinary delete result
 */
export const deleteFromCloudinary = async (publicId) => {
  try {
    const result = await cloudinary.uploader.destroy(publicId);
    return result;
  } catch (error) {
    console.error("Error deleting from cloudinary:", error);
    throw error;
  }
};

/**
 * Upload multiple images to cloudinary
 * @param {Array} files - Array of file buffers
 * @param {string} folder - Cloudinary folder name
 * @returns {Promise<Array>} - Array of upload results
 */
export const uploadMultipleToCloudinary = async (files, folder = "garden") => {
  const uploadPromises = files.map((file, index) =>
    uploadToCloudinary(file.buffer, folder, `${Date.now()}_${index}`)
  );

  return Promise.all(uploadPromises);
};
