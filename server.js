require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const cors = require('cors');
const nodemailer = require('nodemailer');
const randomstring = require('randomstring');
// const bcrypt = require('bcrypt'); // <-- REMOVED BCRYPT

// Import Models
const User = require('./models/User');
const OTP = require('./models/OTP');
const Booking = require('./models/Booking');
const Agencies = require('./models/Agencies');
const Driver = require('./models/Driver');
const Vehicles = require('./models/Vehicles');

const app = express();
const PORT = process.env.PORT || 5000;

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log("Connected to MongoDB");
}).catch(err => {
  console.error("MongoDB connection error:", err);
});

// Middleware
app.use(cors({
  origin: ['https://sharingyatra.vercel.app', 'http://localhost:5000'],
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session Middleware
const store = MongoStore.create({
  mongoUrl: process.env.MONGODB_URI,
  collectionName: 'sessions',
  ttl: 14 * 24 * 60 * 60 // 14 days
});

app.use(session({
  secret: process.env.SESSION_SECRET || 'your_default_secret_key',
  resave: false,
  saveUninitialized: false,
  store: store,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 24 * 60 * 60 * 1000 // 1 day
  }
}));

// --- API ROUTES ---

// Authentication check middleware
const isAuthenticated = (req, res, next) => {
  if (req.session.user) {
    next();
  } else {
    res.status(401).json({ success: false, message: 'Unauthorized: Please log in' });
  }
};

// Booking Routes
app.post('/api/bookings', isAuthenticated, async (req, res) => {
  try {
    const {
      agencyId,
      agencyName,
      driverName,
      vehicle,
      name,
      phone,
      pickup,
      drop,
      date,
      time,
      bookingType,
      sharing,
      totalPrice
    } = req.body;

    const newBooking = new Booking({
      userId: req.session.user.id, // Get user ID from session
      agencyId,
      agencyName,
      driverName,
      vehicle,
      name,
      phone,
      pickup,
      drop,
      date,
      time,
      bookingType,
      sharing,
      totalPrice
    });

    await newBooking.save();
    res.status(201).json({ success: true, message: 'Booking created successfully', booking: newBooking });
  } catch (error) {
    console.error('Error creating booking:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

app.get('/api/bookings', isAuthenticated, async (req, res) => {
  try {
    const bookings = await Booking.find({ userId: req.session.user.id }).sort({ date: -1 });
    res.json({ success: true, bookings });
  } catch (error) {
    console.error('Error fetching bookings:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.put('/api/bookings/:id', isAuthenticated, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }
    if (booking.userId.toString() !== req.session.user.id) {
      return res.status(403).json({ success: false, message: 'User not authorized to update this booking' });
    }
    
    // Add update logic here
    const updatedBooking = await Booking.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ success: true, message: 'Booking updated', booking: updatedBooking });
  } catch (error) {
    console.error('Error updating booking:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.delete('/api/bookings/:id', isAuthenticated, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }
    if (booking.userId.toString() !== req.session.user.id) {
      return res.status(403).json({ success: false, message: 'User not authorized to delete this booking' });
    }
    
    await Booking.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Booking deleted' });
  } catch (error) {
    console.error('Error deleting booking:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});


// User Profile Route
app.get('/api/profile', isAuthenticated, async (req, res) => {
  try {
    // We already have the user info in the session
    res.json({ success: true, user: req.session.user });
  } catch (error) {
    console.error('Error fetching profile:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Logout Route
app.get("/api/logout", (req, res) => { // <-- FIXED: Added /api prefix
  req.session.destroy(err => {
    if (err) {
      return res.status(500).json({ success: false, message: "Could not log out" });
    }
    res.clearCookie('connect.sid');
    res.json({ success: true, message: "Logged out" });
  });
});

// --- Registration and Login ---

// Nodemailer Transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Generate OTP Route
app.post("/api/generate-otp", async (req, res) => { // <-- FIXED: Added /api prefix
  const { email } = req.body;
  try {
    const otp = randomstring.generate({ length: 6, charset: 'numeric' });
    const expiresAt = new Date(new Date().getTime() + 5 * 60 * 1000); // 5 minutes

    await OTP.findOneAndUpdate({ email }, { otp, expiresAt }, { upsert: true, new: true });

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Your OTP for Sharing Yatra',
      text: `Your OTP is: ${otp}. It will expire in 5 minutes.`
    };

    await transporter.sendMail(mailOptions);
    res.json({ success: true, message: 'OTP sent to your email' });
  } catch (err) {
    console.error("OTP Error:", err);
    res.status(500).json({ success: false, message: "Error sending OTP" });
  }
});

// Customer Registration Route
app.post("/api/register", async (req, res) => { // <-- FIXED: Added /api prefix
  const { email, phone, username, password, otp } = req.body;
  try {
    const existingOTP = await OTP.findOne({ email, otp });
    if (!existingOTP) {
      return res.status(400).json({ success: false, message: "Invalid OTP" });
    }
    if (new Date() > existingOTP.expiresAt) {
      return res.status(400).json({ success: false, message: "OTP expired" });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ success: false, message: "Email already registered" });
    }
    
    // --- REMOVED Hashing ---
    const newUser = new User({
      email,
      phone,
      username,
      password: password // Save the plain text password
    });
    
    await newUser.save();
    await OTP.deleteOne({ _id: existingOTP._id }); // Clean up OTP
    
    res.json({ success: true, message: "Registration successful" });
  } catch (err) {
    console.error("Register Error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Main Login Route (Handles all user types)
app.post("/api/login", async (req, res) => { // <-- FIXED: Added /api prefix
  const { email, password } = req.body;

  try {
    let user = null;
    let role = null;
    let redirectUrl = null;
    let emailField = 'email'; // default

    // 1. Check Customer
    user = await User.findOne({ email });
    if (user) {
      role = "customer";
      redirectUrl = "/dashboard.html";
      emailField = 'email';
    }

    // 2. Check Agency
    if (!user) {
      user = await Agencies.findOne({ agencyEmail: email });
      if (user) {
        role = "agency";
        redirectUrl = "/agencyDashboard.html"; // You may need to create this page
        emailField = 'agencyEmail';
      }
    }

    // 3. Check Driver
    if (!user) {
      user = await Driver.findOne({ email: email });
      if (user) {
        role = "driver";
        redirectUrl = "/driverDashboard.html"; // You may need to create this page
        emailField = 'email';
      }
    }

    // 4. User not found
    if (!user) {
      return res.status(400).json({ success: false, message: "Account not found" });
    }

    // 5. --- FIXED: Check password with plain text ---
    if (password !== user.password) {
      return res.status(400).json({ success: false, message: "Invalid password" });
    }

    // 6. Set up session
    req.session.user = {
      id: user._id,
      email: user[emailField], // Use the correct email field
      name: user.username || user.agencyName || user.fullName, // Get best name
      role: role
    };
    
    // 7. Send success
    res.json({
      success: true,
      message: "Login successful",
      redirectTo: redirectUrl // Send redirect URL to frontend
    });

  } catch (err) {
    console.error("Login Error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});


// --- Agency, Driver, Vehicle Routes (Already prefixed with /api) ---

app.post('/api/agencies/register', async (req, res) => {
  try {
    const { agencyName, agencyEmail, phone, address, password } = req.body;
    
    // --- REMOVED Hashing ---
    const newAgency = new Agencies({
      agencyName,
      agencyEmail,
      phone,
      address,
      password: password // Save plain text password
    });
    await newAgency.save();
    res.status(201).json({ success: true, message: 'Agency registered successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error registering agency', error: error.message });
  }
});

app.post('/api/drivers/register', async (req, res) => {
  try {
    const { fullName, email, phone, licenseNumber, agencyId, password } = req.body;

    // --- REMOVED Hashing ---
    const newDriver = new Driver({
      fullName,
      email,
      phone,
      licenseNumber,
      agency: agencyId, 
      password: password // Save plain text password
    });
    await newDriver.save();
    res.status(201).json({ success: true, message: 'Driver registered successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error registering driver', error: error.message });
  }
});

app.post('/api/vehicles/add', async (req, res) => {
  try {
    const { vehicleName, vehicleType, registrationNumber, capacity, agencyId } = req.body;
    const newVehicle = new Vehicles({
      vehicleName,
      vehicleType,
      registrationNumber,
      capacity,
      agency: agencyId
    });
    await newVehicle.save();
    res.status(201).json({ success: true, message: 'Vehicle added successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error adding vehicle', error: error.message });
  }
});

app.get('/api/vehicles/agency/:agencyId', async (req, res) => {
  try {
    const vehicles = await Vehicles.find({ agency: req.params.agencyId });
    res.json({ success: true, vehicles });
  } catch (error) {
    res.status(5This error occurs because your server-side code (in `server.js`) is crashing. The Vercel logs clearly show the problem:

`TypeError: Cannot read properties of undefined (reading 'user')`

This crash happens inside your `isAuthenticated` middleware function.

---

### The Problem

Your `isAuthenticated` middleware is defined like this:

```javascript
// Authentication check middleware
const isAuthenticated = (req, res, next) => {
  if (req.session.user) { // This line is OK
    next();
  } else {
    // This line is OK
    res.status(401).json({ success: false, message: 'Unauthorized: Please log in' }); 
  }
};
