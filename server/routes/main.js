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


router.use(express.static('public'));

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
 
// router.post('/upload', upload.array('files', 10), (req, res) => {
//   const fileUrls = req.files.map(file => `/uploads/${file.filename}`);

//   res.json({
//     success: true,
//     files: fileUrls
//   });
// });

// router.use('/upload', express.static('uploads'));


const adminLayout='../views/layouts/admin';
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

router.get("/checkout", (req, res) => {
  res.render("checkout", {
    currentRoute: '/checkout'
  });
});
 
router.get("/razorpay-checkout", (req, res) => {
  res.render("razorpay-checkout", {
    currentRoute: '/razorpay-checkout'
  });
});


router.post("/create-stripe-session", async (req, res) => {
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
    success_url: "http://localhost:5000/payment-success?session_id={CHECKOUT_SESSION_ID}",
    cancel_url: 'http://localhost:5000/cancel',
  });
  
  res.redirect(303, session.url);
  }catch (error) {
  console.log(error);
  res.status(500).json({ message: 'Internal Server Error' });
  }
});


router.get("/payment-success", async (req, res) => {
  try {
    // Stripe flow
    if (req.query.session_id) {
      const session = await stripe.checkout.sessions.retrieve(req.query.session_id);

      if (session.payment_status === "paid") {
        const user = await User.findById(req.session.user._id);
        if (!user) return res.status(404).send("User not found");

        if (!user.processedSessions.includes(session.id)) {
          user.hasPaid = true;
          user.blogLimit += 100;
          user.processedSessions.push(session.id);
          await user.save();
        }

        return res.render("success", {
          message: "Payment successful via Stripe! 🎉"
        });
      }
    }

    // PayPal flow
    if (req.query.gateway === "paypal") {
      return res.render("success", {
        message: "Payment successful via PayPal! 🎉"
      });
    }

    // Razorpay flow
    if (req.query.gateway === "razorpay") {
      return res.render("success", {
        message: "Payment successful via Razorpay! 🎉"
      });
    }
    console.log(req.query.gateway);
    return res.status(400).send("Invalid payment success callback");
  } catch (err) {
    console.error(err);
    res.status(500).send("Something went wrong");
  }
});



router.post("/create-razorpay-order", async (req, res) => {
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
});

router.post("/razorpay-verify", async (req, res) => {
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
      await user.save();

      return res.json({ success: true });
    } else {
      return res.status(400).json({ success: false, message: "Invalid signature" });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});

// router.get("/razorpay-success", (req, res) => {
//   res.render("success", {
//     message: "Payment successful via Razorpay! You can now post more blogs."
//   });
// });

router.get("/cancel", (req, res) => {
  res.render("cancel");
});

router.get("/create-paypal-order", (req, res) => {
  res.render("checkout", {
    currentRoute: '/create-paypal-order'
  });
});


router.post("/create-paypal-order", async (req, res) => {
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
});
 
router.post("/capture-paypal-order", async (req, res) => {
  const { orderID } = req.body;
  try {
    const request = new OrdersCaptureRequest(orderID);
    request.requestBody({});
    const response = await client().execute(request);
    if (response.result.status === "COMPLETED") {
      const user = await User.findById(req.session.user._id);
      if (!user) return res.status(404).json({ message: "User not found" });
      // Prevent duplicate credits
      if (!user.processedSessions.includes(orderID)) {
        user.hasPaid = true;
        user.blogLimit += 100;
        user.processedSessions.push(orderID);
        await user.save();
      }
      // Return status for frontend to check
      return res.json({ status: "COMPLETED", orderID: response.result.id });
    }
    res.status(400).json({ status: response.result.status, message: "Payment not completed" });
  } catch (err) {
    console.error("Error capturing PayPal order:", err);
    res.status(500).json({ status: "ERROR", error: err.message });
  }
});




router.get('', async (req, res) => {
  try {
    const locals = {
      title: "NodeJs Blog",
      description: "Simple Blog created with NodeJs, Express & MongoDb."
    }

    let perPage = 6;
    let page = parseInt(req.query.page) || 1;

    const data = await Post.aggregate([ { $sort: { createdAt: -1 } } ])
    .skip(perPage * page - perPage)
    .limit(perPage)
    .exec();
    const count = await Post.countDocuments({});
    // const nextPage = parseInt(page) + 1;
    const totalPages = Math.ceil(count / perPage);
    const nextPage = page < totalPages ? page + 1 : null;
    const prevPage = page > 1 ? page - 1 : null;  

    res.render('index', {
      locals,
      data,
      current: page,
      nextPage,
      prevPage,
      totalPages,
      currentRoute: '/'
    });

  } catch (error) {
    console.log(error);
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


router.get('/editor/post/:id', async (req, res) => {
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
      currentRoute: `/editor/post/${slug}`
    });
  } catch (error) {
    console.log(error);
  }
});



router.post('/search', async (req, res) => {
  try {
    const locals = {
      title: "Seach",
      description: "Simple Blog created with NodeJs, Express & MongoDb."
    }

    let searchTerm = req.body.searchTerm;
    const searchNoSpecialChar = searchTerm.replace(/[^a-zA-Z0-9 ]/g, "")

    const data = await Post.find({
      $or: [
        { title: { $regex: new RegExp(searchNoSpecialChar, 'i') }},
        { body: { $regex: new RegExp(searchNoSpecialChar, 'i') }}
      ]
    });

    res.render("search", { 
      data,
      locals,
      currentRoute: '/'
    });

  } catch (error) {
    console.log(error);
  }

});

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

router.get("/signup",(req,res)=>{
  res.render("signup.ejs");
});

router.post("/signup", async (req, res) => {
  try {
    const { firstname, lastname, email, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    try {
      const user = await User.create({ firstname, lastname, email, password: hashedPassword });
      req.session.user = {
        _id: user._id,
        firstname: user.firstname,
        lastname: user.lastname,
        email: user.email
      };
      res.redirect('/');
    } catch (error) {
      if (error.code === 11000) {
        return res.status(409).json({ message: 'Username or Email already in use' });
      }
      return res.status(500).json({ message: 'Internal error' });
    }
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: 'Internal error' });
  }
});


router.get("/login",(req,res)=>{
  res.render("login.ejs");
});


router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !user.password) {
      return res.status(401).render("login.ejs", { error: "Invalid email or password" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).render("login.ejs", { error: "Invalid email or password" });
    }
    req.session.user = {
      _id: user._id,
      firstname: user.firstname,
      lastname: user.lastname,
      email: user.email
    };
    
    req.session.save((err) => {
      if (err) {
        console.error("Session save error:", err);
        return res.status(500).send("Login failed, try again.");
      }
      res.redirect("/editor");
    });

  } catch (error) {
    console.error(error);
    res.status(500).send("Something went wrong, please try again later.");
  }
});

router.get("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ message: "Logout failed" });
    }
    res.clearCookie("connect.sid");
    res.redirect("/");
  });
}); 

router.get("/category/:category", async (req, res)=>{
  try {
    const locals = {
      title: "Category",
      description: "Simple Blog created with NodeJs, Express & MongoDb."
    }
    let category = req.params.category;
    let perPage = 6;
    let page = req.query.page || 1;
    console.log('Requested category:', category);
    const data = await Post.aggregate([ { $match: { category: category } }, { $sort: { createdAt: -1 } } ])
      .skip(perPage * page - perPage)
      .limit(perPage)
      .exec();
    console.log('Fetched posts:', data);
    const count = await Post.countDocuments({ category: category });
    const nextPage = parseInt(page) + 1;
    const hasNextPage = nextPage <= Math.ceil(count / perPage);
    res.render('index', {
      locals,
      data,
      current: page,
      nextPage: hasNextPage ? nextPage : null,
      currentRoute: `/category/${category}`
    });
  } catch (error) { 
    console.log(error);
  }

});

router.get('/editor', async (req, res) => {
  try {
    if (!req.session.user) {
      return res.redirect('/login');
    }

    const userId = req.session.user._id;
    const perPage = 6;
    const page = parseInt(req.query.page) || 1;

    const posts = await Post.find({ author: userId })
      .sort({ createdAt: -1 })
      .skip(perPage * page - perPage)
      .limit(perPage)
      .exec();

    const count = await Post.countDocuments({ author: userId });
    const nextPage = parseInt(page) + 1;
    const hasNextPage = nextPage <= Math.ceil(count / perPage);

    res.render('editor', {
      data: posts,
      current: page,
      nextPage: hasNextPage ? nextPage : null,
      currentRoute: '/editor'
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Error loading editor page");
  }
});

/*editor controls*/

router.get('/editor-edit-post/:id', async (req, res) => {
  try {
    const locals = {
      title: "Edit Post",
      description: "Free NodeJs User Management System",
    };
    const data = await Post.findOne({ _id: req.params.id });
    res.render('editor-edit-post', {
      locals,
      data,
      layout: adminLayout
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
    res.redirect('/editor');
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
    const blogUrl = `http://localhost:5000/post/${blogId}`;
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

module.exports=router;
