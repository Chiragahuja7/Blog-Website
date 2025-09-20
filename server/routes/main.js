const express=require("express");
const router=express.Router();
const Post = require('../models/post');
const User = require("../models/User");
const bcrypt=require("bcrypt");
const stripe=require("stripe")(process.env.STRIPE_SECRET_KEY);
const Razorpay = require("razorpay");
const crypto = require("crypto");
const multer = require('multer');
const path = require('path');
const puppeteer = require('puppeteer');
const { client } = require("../config/paypal");
const checkoutNodeJssdk = require("@paypal/checkout-server-sdk");
const striptags = require("striptags");
const { OrdersCaptureRequest } = checkoutNodeJssdk.orders;
const axios = require('axios');
const jwt =require("jsonwebtoken");
require("dotenv").config();

router.use(express.static('public'));
const editorLayout='../views/layouts/editor-layout';
const checkoutLayout='../views/layouts/checkout-layout';

const storage = multer.diskStorage({
  destination: function(req, file, cb){
    cb(null, './uploads/');
  },
  filename: function(req, file, cb){
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
}); 
const upload = multer({ storage: storage });
 
async function renderMainPage(req, res, user) {
  const locals = {
    title: req.query.term ? "Search Results" : "NodeJs Blog",
    description: "Simple Blog created with NodeJs, Express & MongoDb."
  };

  let perPage = 6;
  let page = parseInt(req.query.page) || 1;
  let searchTerm = req.query.term || "";
  const searchNoSpecialChar = searchTerm.replace(/[^a-zA-Z0-9 ]/g, "");

  let query = { status: "approved" };

  if (!user || !user.hasProAccess) {
    query.isProBlog = { $ne: true };
  }

  if (searchNoSpecialChar) {
    query.$or = [
      { title: { $regex: new RegExp(searchNoSpecialChar, "i") } },
      { body: { $regex: new RegExp(searchNoSpecialChar, "i") } }
    ];
  }

  const data = await Post.find(query)
    .sort({ createdAt: -1 })
    .skip(perPage * (page - 1))
    .limit(perPage)
    .exec();

  const count = await Post.countDocuments(query);
  const totalPages = Math.ceil(count / perPage);
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1);

  res.render("index", {
    locals,
    data,
    searchTerm,
    current: page,
    totalPages,
    pages,
    currentRoute: "/",
    user
  });
}

// router.post('/upload', upload.array('files', 10), (req, res) => {
//   const fileUrls = req.files.map(file => `/uploads/${file.filename}`);

//   res.json({
//     success: true,
//     files: fileUrls
//   });
// });

// router.use('/upload', express.static('uploads'));

function checkBlocked(req, res, next) {
  if (req.user && req.user.isBlocked) {
    return res.status(403).send('Your account has been blocked. Contact admin.');
  }
  next();
}

router.use(checkBlocked);

const adminLayout='../views/layouts/admin';
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

router.get("/checkout", (req, res) => {
  res.render("checkout", {
    currentRoute: '/checkout',
    layout:checkoutLayout
  });
});

//middleware to see if user is editor or not
function checkEditor(req,res,next){
  if(!req.session.user){
    return res.redirect("/login");
  }
  if(req.session.user.userType !=="editor"){
    return res.status(403).send("Access denied. Editors only.");
  }
  next();
}

//stripe
router.post("/create-stripe-session", async (req, res) => {
  if(req.session.user.userType==="editor"){
    try {
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'Blog Upgrade for 100 blogs',
            description: 'Upgrade to premium plan to post more blogs',
          },
          unit_amount: 100, 
        },
        quantity: 100
      },
    ],
    mode: 'payment',
    success_url: `http://localhost:${process.env.PORT}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `http://localhost:${process.env.PORT}/cancel`,
  });
  res.redirect(303, session.url);
  }catch (error) {
  console.log(error);
  res.status(500).json({ message: 'Internal Server Error' });
  }
  }else{
    try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "Pro Access (Reader)",
              description: "Unlock premium content for readers",
            },
            unit_amount: 500,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url:
        `http://localhost:${process.env.PORT}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `http://localhost:${process.env.PORT}/cancel`,
    });

    res.redirect(303, session.url);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal Server Error" });
  }}
});
//Payment Success Route
router.all("/payment-success", async (req, res) => {
  const sessionUser = req.session && req.session.user ? req.session.user : null;
  const queryGateway = req.query.gateway;
  const isEditor = (sessionUser && sessionUser.userType === "editor") || req.query.userType === "editor";

  try {
    // STRIPE flow
    if (req.query.session_id) {
      const stripeSession = await stripe.checkout.sessions.retrieve(req.query.session_id);
      if (stripeSession.payment_status === "paid") {
        const userId = sessionUser?._id || req.query.userId;
        if (userId && userId !== 'guest') {
          const user = await User.findById(userId);
          if (user) {
            if (!Array.isArray(user.processedSessions)) user.processedSessions = [];
            if (!user.processedSessions.includes(stripeSession.id)) {
              if (isEditor) {
                user.hasPaid = true;
                user.blogLimit = (user.blogLimit || 0) + 100;
              } else {
                user.hasProAccess = true;
              }
              user.processedSessions.push(stripeSession.id);
              user.orders.push({
                gateway: "stripe",
                orderId: stripeSession.id,
                amount: stripeSession.amount_total,
                currency: stripeSession.currency ? stripeSession.currency.toUpperCase() : "USD",
                status: "SUCCESS"
              });
              await user.save();
              if (sessionUser) {
                req.session.user = {
                  _id: user._id,
                  firstname: user.firstname,
                  lastname: user.lastname,
                  email: user.email,
                  userType: user.userType,
                  hasProAccess: user.hasProAccess,
                  blogLimit: user.blogLimit
                };
              }
            }
          }
        }

        return res.render("success", {
          message: isEditor ? "Payment successful via Stripe! 🎉" : "You are now a Pro Reader! 🎉"
        });
      }
    }

    // PayPal flow
    if (queryGateway === "paypal") {
      return res.render("success", {
        message: "Payment successful via PayPal! 🎉"
      });
    }

    // Razorpay flow
    if (queryGateway === "razorpay") {
      return res.render("success", {
        message: "Payment successful via Razorpay! 🎉"
      });
    }

    // PhonePe flow
    if (queryGateway === "phonepe") {
      const userId = sessionUser?._id || req.query.userId;
      if (!userId || userId === 'guest') {
        const txnId = req.query.transactionId;
        return res.render("success", {
          message: txnId ? "Payment processed via PhonePe" : "Payment flow completed via PhonePe",
          user: null
        });
      }

      const user = await User.findById(userId);
      if (!user) return res.status(404).send("User not found");

      const txnId = req.query.transactionId || "phonepe_" + Date.now();
      if (!Array.isArray(user.processedSessions)) user.processedSessions = [];

      if (!user.processedSessions.includes(txnId)) {
        if ((sessionUser && sessionUser.userType === "editor") || user.userType === "editor") {
          user.hasPaid = true;
          user.blogLimit = (user.blogLimit || 0) + 100;
          user.orders.push({
            gateway: "phonepe",
            orderId: txnId,
            amount: 930000,
            currency: "INR",
            status: "SUCCESS"
          });
        } else {
          user.hasProAccess = true;
          user.orders.push({
            gateway: "phonepe",
            orderId: txnId,
            amount: 47000,
            currency: "INR",
            status: "SUCCESS"
          });
        }
        user.processedSessions.push(txnId);
        await user.save();
      }

      req.session.user = {
        _id: user._id,
        firstname: user.firstname,
        lastname: user.lastname,
        email: user.email,
        userType: user.userType,
        hasProAccess: user.hasProAccess,
        blogLimit: user.blogLimit
      };

      await new Promise((resolve, reject) => {
        req.session.save(err => (err ? reject(err) : resolve()));
      });

      return res.render("success", {
        message: "Payment successful via PhonePe! 🎉",
        user: req.session.user
      });
    }

    return res.render("cancel", { layout: checkoutLayout });
  } catch (error) {
    console.error("Payment success handler error:", error);
    return res.render("cancel", { layout: checkoutLayout,user: req.session.user || null });
  }
});

//razorpay
router.post("/create-razorpay-order", async (req, res) => {
  if (req.session.user.userType==="editor"){
  try {
    const options = {
      amount: 930000,
      currency: "INR",
      receipt: "rcpt_" + Date.now()
    };
  const order = await razorpay.orders.create(options);
  res.json({ id: order.id, amount: order.amount, currency: order.currency, key: process.env.RAZORPAY_KEY_ID });
  } catch (err) {
    console.error(err);
    res.status(500).send("Something went wrong");
  }
}else{
  try {
    const options = {
      amount: 47000,
      currency: "INR",
      receipt: "rcpt_" + Date.now()
    };
  const order = await razorpay.orders.create(options);
  res.json({ id: order.id, amount: order.amount, currency: order.currency, key: process.env.RAZORPAY_KEY_ID });
  } catch (err) {
    console.error(err);
    res.status(500).send("Something went wrong");
  }
}
});
 
router.post("/razorpay-verify", async (req, res) => {
  if (req.session.user.userType==="editor"){
  try {
    const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;

    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest("hex");

    if (expectedSignature === razorpay_signature) {
      const user = await User.findById(req.session.user._id);
      if (!user) return res.status(404).send("User not found");

      user.hasPaid = true;
      user.blogLimit += 100;
      user.processedSessions.push(razorpay_payment_id);
      user.orders.push({
      gateway: "razorpay",
      orderId: razorpay_payment_id,
      amount: 930000,
      currency: "INR",
      status: "SUCCESS"
      });
      await user.save();
      req.session.user.hasProAccess = user.hasProAccess;

      return res.json({ success: true });
    } else {
      return res.status(400).json({ success: false, message: "Invalid signature" });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
}else{
  try {
    const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;

    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest("hex");

    if (expectedSignature === razorpay_signature) {
      const user = await User.findById(req.session.user._id);
      if (!user) return res.status(404).send("User not found");

      user.hasProAccess = true;
      user.processedSessions.push(razorpay_payment_id);
      user.orders.push({
      gateway: "razorpay",
      orderId: razorpay_payment_id,
      amount: 47000,
      currency: "INR",
      status: "SUCCESS"
      });
      await user.save();
      req.session.user.hasProAccess = user.hasProAccess;

      return res.json({ success: true });
    } else {
      return res.status(400).json({ success: false, message: "Invalid signature" });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
}
});

// router.get("/razorpay-success", (req, res) => {
//   res.render("success", {
//     message: "Payment successful via Razorpay! You can now post more blogs."
//   });
// });

router.get("/cancel", (req, res) => {
  res.render("cancel",{
    layout:checkoutLayout
  });
});

//paypal
router.get("/create-paypal-order", (req, res) => {
  res.render("checkout", {
    currentRoute: '/create-paypal-order'
  });
});

router.post("/create-paypal-order", async (req, res) => {
  if (req.session.user.userType==="editor"){
  try {
    const request = new checkoutNodeJssdk.orders.OrdersCreateRequest();
    request.prefer("return=representation");
    request.requestBody({
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: {
            currency_code: "USD",
            value: "100.00"
          }
        }
      ]
    });
    const order = await client().execute(request);
    res.json({ id: order.result.id });
  } catch (err) {
    console.error("Error creating PayPal order:", err);
    res.status(500).json({ message: "Internal Server Error" });
  }
}else{
  try {
    const request = new checkoutNodeJssdk.orders.OrdersCreateRequest();
    request.prefer("return=representation");
    request.requestBody({
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: {
            currency_code: "USD",
            value: "5.00"
          }
        }
      ]
    });
    const order = await client().execute(request);
    res.json({ id: order.result.id });
  } catch (err) {
    console.error("Error creating PayPal order:", err);
    res.status(500).json({ message: "Internal Server Error" });
  }
}
});
 
router.post("/capture-paypal-order", async (req, res) => {
  const { orderID } = req.body;
  if (req.session.user.userType==="editor"){
  try {
    const request = new OrdersCaptureRequest(orderID);
    request.requestBody({});
    const response = await client().execute(request);
    if (response.result.status === "COMPLETED") {
      const user = await User.findById(req.session.user._id);
      if (!user) return res.status(404).json({ message: "User not found" });
      if (!user.processedSessions.includes(orderID)) {
        user.hasPaid = true;
        user.blogLimit += 100;
        user.processedSessions.push(orderID);

        user.orders.push({
        gateway: "paypal",
        orderId: orderID,
        amount: 10000,     
        currency: "USD",
        status: "SUCCESS"
      });

        await user.save();
      }
      return res.json({ status: "COMPLETED", orderID: response.result.id });
    }
    res.status(400).json({ status: response.result.status, message: "Payment not completed" });
  } catch (err) {
    console.error("Error capturing PayPal order:", err);
    res.status(500).json({ status: "ERROR", error: err.message });
  }
}else{
  try {
    const request = new OrdersCaptureRequest(orderID);
    request.requestBody({});
    const response = await client().execute(request);
    if (response.result.status === "COMPLETED") {
      const user = await User.findById(req.session.user._id);
      if (!user) return res.status(404).json({ message: "User not found" });
      if (!user.processedSessions.includes(orderID)) {
        user.hasProAccess = true;
        user.processedSessions.push(orderID);

        user.orders.push({
        gateway: "paypal",
        orderId: orderID,
        amount: 500,     
        currency: "USD",
        status: "SUCCESS"
      });

        await user.save();
        req.session.user.hasProAccess = user.hasProAccess;

      }
      return res.json({ status: "COMPLETED", orderID: response.result.id });
    }
    res.status(400).json({ status: response.result.status, message: "Payment not completed" });
  } catch (err) {
    console.error("Error capturing PayPal order:", err);
    res.status(500).json({ status: "ERROR", error: err.message });
  }
}
});

//phonepe
const PHONEPE_BASE_URL = process.env.PHONEPE_BASE_URL || "https://api-preprod.phonepe.com/apis/pg-sandbox";
const PHONEPE_MERCHANT_ID = process.env.PHONEPE_MERCHANT_ID;
const PHONEPE_SALT_KEY = process.env.PHONEPE_SALT_KEY;
const PHONEPE_SALT_INDEX = process.env.PHONEPE_SALT_INDEX || 1;

router.post("/create-phonepe-order", async (req, res) => {
  try {
    const user = req.session.user;
    const isEditor = user && user.userType === "editor";
    const amount = isEditor ? 930000 : 47000;

    const merchantTransactionId = "TXN_" + Date.now();

    const payload = {
      merchantId: PHONEPE_MERCHANT_ID,
      merchantTransactionId,
      merchantUserId: user?._id || "guest",
      amount,
      redirectUrl: `http://localhost:${process.env.PORT}/payment-success?gateway=phonepe&userId=${user?._id || "guest"}`,
      redirectMode: "GET",
      callbackUrl: `http://localhost:${process.env.PORT}/payment-callback`,
      paymentInstrument: { type: "PAY_PAGE" }
    };

    const base64Payload = Buffer.from(JSON.stringify(payload)).toString("base64");

    const checksum = crypto
      .createHash("sha256")
      .update(base64Payload + "/pg/v1/pay" + PHONEPE_SALT_KEY)
      .digest("hex") + "###" + PHONEPE_SALT_INDEX;

    const response = await axios.post(
      `${PHONEPE_BASE_URL}/pg/v1/pay`,
      { request: base64Payload },
      {
        headers: {
          "Content-Type": "application/json",
          "X-VERIFY": checksum,
          "X-MERCHANT-ID": PHONEPE_MERCHANT_ID
        }
      }
    );

    const redirectUrl = response.data?.data?.instrumentResponse?.redirectInfo?.url;
    res.json({ url: redirectUrl });

  } catch (err) {
    console.error("PhonePe Order Error:", err.response?.data || err.message);
    res.status(500).json({ error: "Something went wrong with PhonePe order" });
  }
});

router.post("/payment-callback", async (req, res) => {
  console.log("PhonePe Callback:", req.body);
  res.sendStatus(200);
}); 

router.get("/order-history", async (req, res) => {
  if (!req.session.user) return res.redirect("/login");

  const user = await User.findById(req.session.user._id).lean();
  if (!user) return res.status(404).send("User not found");

  res.render("order-history", {
    orders: user.orders || [],
    layout:editorLayout

  });
}); 

//pagination + Main page + search
router.get("/", async (req, res) => {
  try {
    if (!req.session.user) {
      return renderMainPage(req, res, null);
    }

    const user = req.session.user;

    if (user.isAdmin) {
      return res.redirect("/admin-dashboard");
    }

    if (user.userType === "editor") {
      return res.redirect("/editor-dashboard");
    }

    return renderMainPage(req, res, user);
  } catch (error) {
    console.error(error);
    res.status(500).send("Server Error");
  }
});


// router.get('/editor', async (req, res) => {
//   try {
//     const locals = {
//       title: "NodeJs Blog",
//       description: "Simple Blog created with NodeJs, Express & MongoDb."
//     }

//     let perPage = 6;
//     let page = req.query.page || 1;

//     const data = await Post.aggregate([ { $sort: { createdAt: -1 } } ])
//     .skip(perPage * page - perPage)
//     .limit(perPage)
//     .exec();
//     const count = await Post.countDocuments({});
//     const nextPage = parseInt(page) + 1;
//     const hasNextPage = nextPage <= Math.ceil(count / perPage);

//     res.render('editor', { 
//       locals,
//       data,
//       current: page,
//       nextPage: hasNextPage ? nextPage : null,
//       currentRoute: '/editor'
//     });

//   } catch (error) {
//     console.log(error);
//   }

// });


router.get('/post/:id', async (req, res) => {
  try {
    let slug = req.params.id;

    const data = await Post.findById({ _id: slug });

    const locals = {
      title: data.title,
      description: "Simple Blog created with NodeJs, Express & MongoDb.",
    }
    const plainText = striptags(data.body);

    res.render('post', { 
      locals,
      data,
      blogText: plainText,
      currentRoute: `/post/${slug}`
    });
  } catch (error) {
    console.log(error);
  }
});


router.get('/editor/post/:id',checkEditor, async (req, res) => {
  try {
    let slug = req.params.id;

    const data = await Post.findById({ _id: slug });

    const locals = {
      title: data.title,
      description: "Simple Blog created with NodeJs, Express & MongoDb.",
    }

    res.render('editor-post', { 
      locals,
      data,
      currentRoute: `/editor/post/${slug}`,
      layout:editorLayout
    }); 
  } catch (error) {
    console.log(error);
  }
});

// router.get('/search', async (req, res) => {
//   try {
//     const locals = {
//       title: "Search Results",
//       description: "Simple Blog created with NodeJs, Express & MongoDb."
//     };

//     let perPage = 6;
//     let page = parseInt(req.query.page) || 1;
//     let searchTerm = req.query.term || "";
//     const searchNoSpecialChar = searchTerm.replace(/[^a-zA-Z0-9 ]/g, "");

//     // Define query once so we can reuse
//     const query = {
//       $or: [
//         { title: { $regex: new RegExp(searchNoSpecialChar, "i") } },
//         { body: { $regex: new RegExp(searchNoSpecialChar, "i") } }
//       ]
//     };

//     const data = await Post.find(query)
//       .sort({ createdAt: -1 })
//       .skip(perPage * (page - 1))
//       .limit(perPage)
//       .exec();

//     const count = await Post.countDocuments(query);

//     const totalPages = Math.ceil(count / perPage);
//     const pages = Array.from({ length: totalPages }, (_, i) => i + 1);

//     res.render("index", {
//       data,
//       locals,
//       searchTerm,
//       current: page,
//       totalPages,
//       pages,
//       currentRoute: "/search"
//     });
//   } catch (error) {
//     console.error(error);
//   }
// });





router.get("/about" , (req,res)=>{
    res.render('about',{
      currentRoute:'/about'
    });
});

router.get("/contact",(req,res)=>{
  res.render('contact',{
    currentRoute:'/contact'
  });
});

router.get("/profile",async (req,res)=>{
    if(!req.session.user){
    return res.redirect("/login");
  }
const user = await User.findById(req.session.user._id)
  .select("firstname lastname email userType blogLimit blogsPosted")
  .lean();
  res.render("profile.ejs",{
    user,
    success:req.query.success,
    error:req.query.error,});
});

router.get("/edit-profile",async (req,res)=>{
  if(!req.session.user){
    return res.redirect("/login");
  }
  const user = await User.findById(req.session.user._id)
    .select("firstname lastname email userType blogLimit blogsPosted")
    .lean();
  res.render("edit-profile.ejs",{user});
});

router.post("/edit-profile", async (req, res) => {
  try {
    const { firstname, lastname, email } = req.body;
    const updatedUser = await User.findByIdAndUpdate(
      req.session.user._id,
      { firstname, lastname, email },
      { new: true, runValidators: true }
    );
    req.session.user = updatedUser;
    req.session.save((err) => {
      if (err) {
        console.error("Session save error:", err);
        return res.status(500).send("Profile update failed, try again.");
      }
      res.redirect("/profile?success=status");
    });
  } catch (error) {
    console.log(error);
    res.status(500).send("Internal Server Error");
  }
});


router.get("/signup",(req,res)=>{
  res.render("signup.ejs" , {data:{},
  error: null });
});

router.post("/signup", async (req, res) => {
  try {
    const { firstname, lastname, email, password, userType } = req.body;

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      firstname,
      lastname,
      email,
      password: hashedPassword,
      userType
    });

    // store session
    req.session.user = {
      _id: user._id,
      firstname: user.firstname,
      lastname: user.lastname,
      email: user.email,
      userType: user.userType || "reader"
    };

    res.redirect("/login?success=registered");

  } catch (error) {
    console.error(error);

    if (error.code === 11000) {

      return res.render("signup", { error: "Email already in use" ,data: req.body});
    }

    return res.render("signup", { error: "Internal error, please try again",data: req.body });
  }
});

router.get("/login",(req,res)=>{
  res.render("login.ejs",{
    success:req.query.success,
    error:req.query.error,
  });
});

const jwtSecret=process.env.JWT_SECRET;

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !user.password) {
      return res.status(401).render("login.ejs", { error: "Invalid email or password" });
    }
    if (user.isBlocked) {
      return res.status(403).render("login.ejs", { error: "Your account has been blocked. Contact admin." });
    }
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).render("login.ejs", { error: "Invalid email or password" });
    }
    const token = jwt.sign({ userId: user._id}, jwtSecret );
    res.cookie('token', token, { httpOnly: true });
      
    req.session.user = {
      _id: user._id,
      firstname: user.firstname,
      lastname: user.lastname,
      email: user.email,
      userType:user.userType,
      hasProAccess:user.hasProAccess,
      isAdmin:user.isAdmin,
    };
    
    req.session.save((err) => {
      if (err) {
        console.error("Session save error:", err);
        return res.status(500).send("Login failed, try again.");
      }
      if (user.userType === "editor") {
        return res.redirect("/editor-dashboard");
      }
      if(user.isAdmin===true){
        return res.redirect('/admin-dashboard');
      }
      return res.redirect("/");
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Something went wrong, please try again later.");
  }
});


//   req.session.destroy((err) => {
//     if (err) {
//       return res.status(500).json({ message: "Logout failed" });
//     }
//     res.clearCookie("connect.sid");
//     res.redirect("/");
//   });
// }); 

router.get("/category/:category", async (req, res) => {
  try {
    const locals = {
      title: "Category",
      description: "Simple Blog created with NodeJs, Express & MongoDb."
    };
    let category = req.params.category;
    let perPage = 6;
    let page = parseInt(req.query.page) || 1;
    let query = { category: category, status: "approved", };

    console.log('Requested category:', category);
    const data = await Post.aggregate([
      { $match: query },
      { $sort: { createdAt: -1 } }
    ])
      .skip(perPage * (page - 1))
      .limit(perPage)
      .exec();

    const count = await Post.countDocuments(query);
    const totalPages = Math.ceil(count / perPage);
    const pages = Array.from({ length: totalPages }, (_, i) => i + 1);

    res.render('index', {
      locals,
      data,
      current: page,
      totalPages,
      pages,
      currentRoute: `/category/${category}`
    });
  } catch (error) {
    console.log(error);
  }
});

router.get('/editor',checkEditor, async (req, res) => {
  try {
    if (!req.session.user) {
      return res.redirect('/login');
    }

    const userId = req.session.user._id;
    let perPage = 6;
    let page = parseInt(req.query.page) || 1;

    const posts = await Post.find({ author: userId })
      .sort({ createdAt: -1 })
      .skip(perPage * page - perPage)
      .limit(perPage)
      .exec();

    const count = await Post.countDocuments({ author: userId });
    const totalPages = Math.ceil(count / perPage);
    const pages = Array.from({ length: totalPages }, (_, i) => i + 1);  

    // const nextPage = parseInt(page) + 1;
    // const hasNextPage = nextPage <= Math.ceil(count / perPage);

    res.render('editor', {
      data: posts,
      current: page,
      totalPages,
      pages,
      currentRoute: '/',
      layout: editorLayout,
      success:req.query.success,
      error:req.query.error
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Error loading editor page");
  }
});

/*editor controls*/

router.get('/editor-edit-post/:id',checkEditor, async (req, res) => {
  try {
    const locals = {
      title: "Edit Post",
      description: "Free NodeJs User Management System",
    };
    const data = await Post.findOne({ _id: req.params.id });
    res.render('editor-edit-post', {
      locals,
      data,
      layout: editorLayout
    })
  } catch (error) {
    console.log(error);
  }
});

router.put('/editor-edit-post/:id', upload.single('image'), async (req, res) => {
  try {
    const updateData = {
      title: req.body.title,
      body: req.body.body,
      category: req.body.category,
      status: req.body.status,
      updatedAt: Date.now()
    };
    if (req.file) {
      updateData.image = `/uploads/${req.file.filename}`;
    }
    await Post.findByIdAndUpdate(req.params.id, updateData);
    res.redirect('/editor?success=status');
  } catch (err) {
    console.error(err);
  }
});

router.delete('/editor-delete-post/:id', async (req, res) => {

  try {
    await Post.deleteOne( { _id: req.params.id } );
    res.redirect('/editor');
  } catch (error) {
    console.log(error);
  }

});

router.get('/download/:id', async (req, res)=>{
  try {
    let blogId = req.params.id;
    const blogUrl = `http://localhost:${process.env.PORT}/post/${blogId}`;
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.goto(blogUrl, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
    await browser.close();
    res.contentType("application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="blog-${blogId}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    console.log(error);
    res.status(500).send("Error generating PDF");
  }
}); 

router.get("/editor-dashboard", checkEditor,(req, res)=>{
  res.render("editor-dashboard",{
    layout:editorLayout
  });
});

router.get("/settings",(req,res)=>{
  res.render("settings",{
    layout:editorLayout
  });
})

router.get("/help",(req,res)=>{
  res.render("help",{
    layout:editorLayout
});
})

// router.get("/logout", (req, res) => {
module.exports=router; 
