const express=require("express");
const router=express.Router();
const Post = require('../models/post');
const User = require("../models/User");
const bcrypt=require("bcrypt");
const stripe=require("stripe")(process.env.STRIPE_SECRET_KEY);

const adminLayout='../views/layouts/admin';

router.get("/checkout", (req, res) => {
  res.render("checkout", {
    currentRoute: '/checkout'
  });
});

router.post("/create-checkout-session", async (req, res) => {
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
    const session = await stripe.checkout.sessions.retrieve(req.query.session_id);

    if (session.payment_status === "paid") {
      const user = await User.findById(req.session.user._id);

      if (!user) {
        return res.status(404).send("User not found");
      }

      if (!user.processedSessions.includes(session.id)) {
        user.hasPaid = true;
        user.blogLimit += 100;
        user.processedSessions.push(session.id);

        await user.save();
      }

      res.render("success", {
        message: "Payment successful! You can now post more blogs."
      });
    } else {
      res.send("Payment not successful. Please try again.");
    }
  } catch (err) {
    console.error(err);
    res.status(500).send("Something went wrong");
  }
});




router.get("/cancel", (req, res) => {
  res.render("cancel");
});


router.get('', async (req, res) => {
  try {
    const locals = {
      title: "NodeJs Blog",
      description: "Simple Blog created with NodeJs, Express & MongoDb."
    }

    let perPage = 6;
    let page = req.query.page || 1;

    const data = await Post.aggregate([ { $sort: { createdAt: -1 } } ])
    .skip(perPage * page - perPage)
    .limit(perPage)
    .exec();
    const count = await Post.countDocuments({});
    const nextPage = parseInt(page) + 1;
    const hasNextPage = nextPage <= Math.ceil(count / perPage);

    res.render('index', { 
      locals,
      data,
      current: page,
      nextPage: hasNextPage ? nextPage : null,
      currentRoute: '/'
    });

  } catch (error) {
    console.log(error);
  }

});


router.get('/post/:id', async (req, res) => {
  try {
    let slug = req.params.id;

    const data = await Post.findById({ _id: slug });

    const locals = {
      title: data.title,
      description: "Simple Blog created with NodeJs, Express & MongoDb.",
    }

    res.render('post', { 
      locals,
      data,
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
    if (!user) {
      return res.status(401).json({ message: "Invalid email or password" });
    }
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid email or password" });
    }
 
    req.session.user = {
      _id: user._id,
      firstname: user.firstname,
      lastname: user.lastname,
      email: user.email
    };

    res.redirect("/editor");
  } catch (error) {
    console.error(error);
    res.status(500).json(error);
  }
});

router.get("/logout",(req,res)=>{
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ message: "Logout failed" });
    }
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
    // Ensure user is logged in
    if (!req.session.user) {
      return res.redirect('/login');
    }
    const userId = req.session.user._id;
    const posts = await Post.find({ author: userId });
    res.render('editor', {
      data: posts,
      nextPage: null // or your pagination logic
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


router.put('/editor-edit-post/:id', async (req, res) => {
  try {
 
    await Post.findByIdAndUpdate(req.params.id, {
      title: req.body.title,
      body: req.body.body,
      status: req.body.status,
      image: req.body.image,
      updatedAt: Date.now()
    });

    res.redirect(`/editor`);

  } catch (error) {
    console.log(error);
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


module.exports=router;
