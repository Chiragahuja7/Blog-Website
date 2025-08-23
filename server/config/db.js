const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    mongoose.set("strictQuery", false);

    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      ssl: true,   // force SSL/TLS
      tls: true,   // explicit TLS
      serverSelectionTimeoutMS: 5000, // avoid hanging forever
    });

    console.log(`✅ Database Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error("❌ MongoDB connection error:", error.message);
    process.exit(1); // exit on DB failure
  }
};

module.exports = connectDB;
