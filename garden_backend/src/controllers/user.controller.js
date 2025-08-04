import User from "../models/user.model.js";
import {
  sendSuccessResponse,
  sendErrorResponse,
  asyncHandler,
  validateRequiredFields,
  sanitizeInput,
} from "../utils/api.utils.js";
import {
  uploadToCloudinary,
  deleteFromCloudinary,
} from "../utils/cloudinary.utils.js";

// Set cookie options
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict",
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

// Generate tokens and set cookies
const generateTokensAndSetCookies = async (user, res) => {
  const accessToken = user.generateAccessToken();
  const refreshToken = user.generateRefreshToken();

  // Save refresh token to database
  user.refreshToken = refreshToken;
  await user.save();

  // Set cookies
  res.cookie("token", accessToken, cookieOptions);
  res.cookie("refreshToken", refreshToken, {
    ...cookieOptions,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days for refresh token
  });

  return { accessToken, refreshToken };
};

// @desc    Register new user
// @route   POST /api/v1/user/register
// @access  Public
export const register = asyncHandler(async (req, res) => {
  const { username, email, password, phone } = req.body;

  // Validate required fields
  const validation = validateRequiredFields(req.body, [
    "username",
    "email",
    "password",
  ]);
  if (!validation.isValid) {
    return sendErrorResponse(
      res,
      400,
      `Missing required fields: ${validation.missingFields.join(", ")}`
    );
  }

  // Sanitize inputs
  const sanitizedData = {
    username: sanitizeInput(username),
    email: sanitizeInput(email).toLowerCase(),
    password: password,
    ...(phone && { phone: sanitizeInput(phone) }),
  };

  // Check if user already exists
  const existingUser = await User.findOne({ email: sanitizedData.email });
  if (existingUser) {
    return sendErrorResponse(res, 409, "User already exists with this email");
  }

  // Create new user
  const user = await User.create(sanitizedData);

  // Generate tokens and set cookies
  await generateTokensAndSetCookies(user, res);

  // Remove password from response
  const userResponse = user.toJSON();

  sendSuccessResponse(res, 201, "User registered successfully", {
    user: userResponse,
  });
});

// @desc    Login user
// @route   POST /api/v1/user/login
// @access  Public
export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  // Validate required fields
  const validation = validateRequiredFields(req.body, ["email", "password"]);
  if (!validation.isValid) {
    return sendErrorResponse(
      res,
      400,
      `Missing required fields: ${validation.missingFields.join(", ")}`
    );
  }

  // Find user and include password for comparison
  const user = await User.findOne({ email: email.toLowerCase() }).select(
    "+password"
  );
  if (!user) {
    return sendErrorResponse(res, 401, "Invalid email or password");
  }

  // Check if user is active
  if (!user.isActive) {
    return sendErrorResponse(
      res,
      401,
      "Account is deactivated. Please contact support"
    );
  }

  // Compare password
  const isPasswordCorrect = await user.comparePassword(password);
  if (!isPasswordCorrect) {
    return sendErrorResponse(res, 401, "Invalid email or password");
  }

  // Update last login
  user.lastLogin = new Date();
  await user.save();

  // Generate tokens and set cookies
  await generateTokensAndSetCookies(user, res);

  // Remove password from response
  const userResponse = user.toJSON();

  sendSuccessResponse(res, 200, "Login successful", {
    user: userResponse,
  });
});

// @desc    Logout user
// @route   GET /api/v1/user/logout
// @access  Private
export const logout = asyncHandler(async (req, res) => {
  // Clear refresh token from database
  await User.findByIdAndUpdate(req.id, { refreshToken: null });

  // Clear cookies
  res.clearCookie("token");
  res.clearCookie("refreshToken");

  sendSuccessResponse(res, 200, "Logout successful");
});

// @desc    Get user profile
// @route   GET /api/v1/user/profile
// @access  Private
export const getUserProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.id).populate(
    "wishlist",
    "name price image"
  );

  if (!user) {
    return sendErrorResponse(res, 404, "User not found");
  }

  sendSuccessResponse(res, 200, "Profile fetched successfully", {
    user,
  });
});

// @desc    Get current user info
// @route   GET /api/v1/user/getMyInfo
// @access  Private
export const getMyInfo = asyncHandler(async (req, res) => {
  let user = req.user;

  // Fix address if it's a string (migration fix)
  if (user.address && typeof user.address === "string") {
    try {
      console.log(
        "🔧 MIGRATION - Converting string address to object for getMyInfo"
      );
      const userDoc = await User.findById(user._id);
      userDoc.address = JSON.parse(user.address);
      await userDoc.save();
      user = userDoc;
      console.log("✅ MIGRATION - Address converted successfully in getMyInfo");
    } catch (error) {
      console.log(
        "❌ MIGRATION - Failed to parse address in getMyInfo:",
        error
      );
    }
  }

  sendSuccessResponse(res, 200, "User info fetched successfully", {
    user,
  });
});

// @desc    Update user profile
// @route   PATCH /api/v1/user/profile/edit
// @access  Private
export const updateUserProfile = asyncHandler(async (req, res) => {
  console.log("🔍 UPDATE PROFILE - Request Body:", req.body);
  console.log("🔍 UPDATE PROFILE - Request File:", req.file);

  const { username, phone, address } = req.body;

  const updateData = {};

  if (username) updateData.username = sanitizeInput(username);
  if (phone) updateData.phone = sanitizeInput(phone);

  // Handle address properly - ensure it's an object, not a string
  if (address) {
    console.log("🔍 ADDRESS - Type:", typeof address, "Value:", address);
    // If address is a string (JSON), parse it
    if (typeof address === "string") {
      try {
        updateData.address = JSON.parse(address);
        console.log("🔍 ADDRESS - Parsed:", updateData.address);
      } catch (error) {
        console.log("❌ ADDRESS - Parse Error:", error);
        return sendErrorResponse(res, 400, "Invalid address format");
      }
    } else {
      // If address is already an object, use it directly
      updateData.address = address;
      console.log("🔍 ADDRESS - Direct Object:", updateData.address);
    }
  }

  console.log("🔍 UPDATE DATA - Final:", updateData);

  // Handle avatar upload if file is provided
  if (req.file) {
    try {
      const user = await User.findById(req.id);

      // Delete old avatar if exists
      if (user.avatar && user.avatar.public_id) {
        await deleteFromCloudinary(user.avatar.public_id);
      }

      // Upload new avatar
      const uploadResult = await uploadToCloudinary(
        req.file.buffer,
        "garden/avatars",
        `avatar_${req.id}_${Date.now()}`
      );

      updateData.avatar = {
        public_id: uploadResult.public_id,
        url: uploadResult.url,
      };
    } catch (error) {
      console.error("Avatar upload error:", error);
      return sendErrorResponse(res, 500, "Failed to upload avatar");
    }
  }

  const updatedUser = await User.findByIdAndUpdate(req.id, updateData, {
    new: true,
    runValidators: true,
  }).populate("wishlist", "name price image");

  if (!updatedUser) {
    return sendErrorResponse(res, 404, "User not found");
  }

  console.log("✅ UPDATE SUCCESS - Updated User:", updatedUser);

  // Fix address if it's still a string after update (migration fix)
  if (updatedUser.address && typeof updatedUser.address === "string") {
    try {
      console.log("🔧 MIGRATION - Converting string address to object");
      const parsedAddress = JSON.parse(updatedUser.address);
      updatedUser.address = parsedAddress;
      await updatedUser.save();
      console.log(
        "✅ MIGRATION - Address converted successfully:",
        updatedUser.address
      );
    } catch (error) {
      console.log("❌ MIGRATION - Failed to parse address:", error);
    }
  }

  sendSuccessResponse(res, 200, "Profile updated successfully", {
    user: updatedUser,
  });
});

// @desc    Get all users (Admin only)
// @route   GET /api/v1/user/all
// @access  Private/Admin
export const getAllUsers = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, search = "", role = "" } = req.query;

  // Build query
  const query = {};
  if (search) {
    query.$or = [
      { username: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
    ];
  }
  if (role) {
    query.role = role;
  }

  // Calculate pagination
  const skip = (page - 1) * limit;

  // Get users with pagination
  const users = await User.find(query)
    .select("-refreshToken")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit));

  const total = await User.countDocuments(query);

  sendPaginatedResponse(
    res,
    users,
    parseInt(page),
    parseInt(limit),
    total,
    "Users fetched successfully"
  );
});

// @desc    Add/Remove product from wishlist
// @route   PATCH /api/v1/user/wishlist/:productId
// @access  Private
export const toggleWishlist = asyncHandler(async (req, res) => {
  const { productId } = req.params;

  const user = await User.findById(req.id);
  if (!user) {
    return sendErrorResponse(res, 404, "User not found");
  }

  const isInWishlist = user.wishlist.includes(productId);

  if (isInWishlist) {
    // Remove from wishlist
    user.wishlist = user.wishlist.filter((id) => id.toString() !== productId);
    await user.save();

    sendSuccessResponse(res, 200, "Product removed from wishlist");
  } else {
    // Add to wishlist
    user.wishlist.push(productId);
    await user.save();

    sendSuccessResponse(res, 200, "Product added to wishlist");
  }
});

// @desc    Get user wishlist
// @route   GET /api/v1/user/wishlist
// @access  Private
export const getWishlist = asyncHandler(async (req, res) => {
  const user = await User.findById(req.id).populate({
    path: "wishlist",
    select: "name price oldPrice image category stock isAvailable ratings",
  });

  if (!user) {
    return sendErrorResponse(res, 404, "User not found");
  }

  sendSuccessResponse(res, 200, "Wishlist fetched successfully", {
    wishlist: user.wishlist,
  });
});

// @desc    Change password
// @route   PATCH /api/v1/user/change-password
// @access  Private
export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  // Validate required fields
  const validation = validateRequiredFields(req.body, [
    "currentPassword",
    "newPassword",
  ]);
  if (!validation.isValid) {
    return sendErrorResponse(
      res,
      400,
      `Missing required fields: ${validation.missingFields.join(", ")}`
    );
  }

  // Get user with password
  const user = await User.findById(req.id).select("+password");
  if (!user) {
    return sendErrorResponse(res, 404, "User not found");
  }

  // Check current password
  const isCurrentPasswordCorrect = await user.comparePassword(currentPassword);
  if (!isCurrentPasswordCorrect) {
    return sendErrorResponse(res, 400, "Current password is incorrect");
  }

  // Validate new password
  if (newPassword.length < 6) {
    return sendErrorResponse(
      res,
      400,
      "New password must be at least 6 characters long"
    );
  }

  // Update password
  user.password = newPassword;
  await user.save();

  sendSuccessResponse(res, 200, "Password changed successfully");
});
