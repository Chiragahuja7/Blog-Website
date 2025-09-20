const express=require("express");
const router=express.Router();
const Post = require('../models/post');
const User = require('../models/User');
const bcrypt=require("bcrypt");
const jwt =require("jsonwebtoken");
require("dotenv").config();
const multer = require("multer");
const path = require("path");
const cookieParser = require("cookie-parser");
const fs = require("fs");

router.use(cookieParser());

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 2 * 1024 * 1024 }
});

const adminLayout='../views/layouts/admin';
const jwtSecret=process.env.JWT_SECRET;

const authMiddleware = async (req, res, next) => {
  const token = req.cookies.token;
  if (!token) {
    return res.status(401).send('Unauthorized');
  }
  try {
    const decoded = jwt.verify(token, jwtSecret);
    const user = await User.findById(decoded.userId);
    if (!user || !user.isAdmin) {
      return res.status(403).send('Access denied'); 
    }
    req.user = { _id: user._id, isAdmin: user.isAdmin };
    next();
  } catch (err) {
    console.error(err);
    return res.status(401).send('Unauthorized');
  }
};

// router.get('/admin', async (req, res) => {
//   try {
//     const locals = {
//       title: "Admin",
//       description: "Simple Blog created with NodeJs, Express & MongoDb."
//     }

//     res.render('admin/index', { locals, layout: adminLayout });
//   } catch (error) {
//     console.log(error);
//   }
// });



// router.post('/admin', async (req, res) => {
//   try {
//     const { email, password } = req.body;
    
//     const user = await User.findOne( { email } );

//     if(!user) {
//       return res.status(401).json( { message: 'Invalid credentials' } );
//     }

//     const isPasswordValid = await bcrypt.compare(password, user.password);

//     if(!isPasswordValid) {
//       return res.status(401).json( { message: 'Invalid credentials' } );
//     }

//     const token = jwt.sign({ userId: user._id}, jwtSecret );
//     res.cookie('token', token, { httpOnly: true });

//     if(user.isAdmin){
//       res.redirect('/dashboard');
//     }

//   } catch (error) {
//     console.log(error);
//   }
// });


// router.post('/register', async (req, res) => {
//   try {
//     const { username, password } = req.body;
//     const hashedPassword = await bcrypt.hash(password, 10);

//     try {
//       const user = await User.create({ username, password:hashedPassword });
//       res.status(201).json({ message: 'User Created', user });
//     } catch (error) {
//       if(error.code === 11000) {
//         res.status(409).json({ message: 'User already in use'});
//       }
//       res.status(500).json({ message: 'Internal server error'})
//     }

//   } catch (error) {
//     console.log(error);
//   }
// });

router.get("/admin-dashboard",authMiddleware ,(req,res)=>{
  res.render("admin-dashboard",{
    layout:adminLayout
  });
});

router.get('/dashboard', authMiddleware, async (req, res) => {
  try {
    const locals = {
      title: 'Dashboard',
      description: 'Simple Blog created with NodeJs, Express & MongoDb.'
    }
    let perPage = 10;
    let page = parseInt(req.query.page) || 1;

    const data = await Post.find()
    .sort({ createdAt: -1 })
    .skip(perPage * (page - 1))
    .limit(perPage)
    .exec();
    
    const count = await Post.countDocuments();
    const totalPages = Math.ceil(count / perPage);
    const pages = Array.from({ length: totalPages }, (_, i) => i + 1);

    if(req.user.isAdmin) {
    res.render('admin/dashboard', {
      locals,
      data,
      current: page,
      totalPages,
      pages,
      layout: adminLayout,
      success:req.query.success,
      error:req.query.error,
    });
  }
  } catch (error) {
    console.log(error);
  }
});

router.get('/add-post', authMiddleware, async (req, res) => {
  try {
    const locals = {
      title: 'Add Post',
      description: 'Simple Blog created with NodeJs, Express & MongoDb.'
    }

    const data = await Post.find();
    res.render('admin/add-post', {
      locals,
      layout: adminLayout
    });

  } catch (error) {
    console.log(error);
  }

});

router.post('/add-post', authMiddleware, upload.array("images", 3), async (req, res) => {
  try {
    console.log('Full req.body:', req.body);
    const { title, body, category } = req.body;
    const imagePaths = req.files ? req.files.map(file => "/uploads/" + file.filename) : [];
    console.log('Category received from form:', category);
    const newPost = new Post({
      title,
      body,
      image: imagePaths,
      category: category || "uncategorized",
      author: req.session.user._id
    });
    console.log('New post to be saved:', newPost);
    await newPost.save();
    res.redirect('/dashboard');
  } catch (err) {
    console.error(err);
    res.status(500).send("Error saving post");
  }
});

router.get('/edit-post/:id', authMiddleware, async (req, res) => {
  try {

    const locals = {
      title: "Edit Post",
      description: "Free NodeJs User Management System",
    };

    const data = await Post.findOne({ _id: req.params.id });

    res.render('admin/edit-post', {
      locals,
      data,
      layout: adminLayout,
      
    })

  } catch (error) {
    console.log(error);
  }

});


router.put('/edit-post/:id', authMiddleware, async (req, res) => {
  try {
 
    await Post.findByIdAndUpdate(req.params.id, {
      title: req.body.title,
      body: req.body.body,
      status: req.body.status,
      image: req.body.image,
      updatedAt: Date.now()
    });

    res.redirect(`/dashboard?success=status`);

  } catch (error) {
    console.log(error);
    res.redirect(`/dashboard?error=true`);
  }

});

router.delete('/delete-post/:id', authMiddleware, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);

    if (!post) {
      return res.status(404).send("Post not found");
    }
    if (post.image) {
      const images = Array.isArray(post.image)?post.image:[post.image];

      for (const img of images) {
        const fileName = img.replace(/^\/?uploads\//, "");
        const imagePath = path.join(__dirname, "../../uploads", fileName);
        try {
          await fs.promises.unlink(imagePath);
        } catch (err) {
          console.error("Failed to delete image:", img, err);
        }
      }
    }

    // Delete the post from the database
    await Post.deleteOne({ _id: req.params.id });

    res.redirect('/dashboard');
  } catch (error) {
    console.error(error);
    res.status(500).send("Server error");
  }
});

router.get("/logout", (req, res) => {
  res.clearCookie("token", { httpOnly: true, path: "/" });
  res.clearCookie("connect.sid", { path: "/" });
  req.session.destroy((err) => {
    if (err) console.error("Session destroy error:", err);
    return res.redirect("/");
  });
});


//Block and Unblock Users
router.get("/manage-editor",authMiddleware,async(req,res)=>{
  try{
    const data=await User.find().lean();
    res.render("admin/manage-editor",{data,layout:adminLayout});
  }catch(error){
    console.log(error);
    res.status(500).send("Error fetching users");
  }});

router.get("/manage-reader",authMiddleware,async(req,res)=>{
  try{
    const data=await User.find().lean();
    res.render("admin/manage-reader",{data,layout:adminLayout});
  }catch(error){
    console.log(error);
    res.status(500).send("Error fetching users");
  }});

 
router.post("/block-editor/:id",authMiddleware,async(req,res)=>{
  try{
    await User.findByIdAndUpdate(req.params.id,{isBlocked:true});
    res.redirect("/manage-editor");
  }catch(error){
    console.log(error);
    res.status(500).send("Error blocking user");
  }
});

router.post("/unblock-editor/:id",authMiddleware,async(req,res)=>{
  try{
    await User.findByIdAndUpdate(req.params.id,{isBlocked:false});
    res.redirect("/manage-editor");
  }catch(error){ 
    console.log(error);
    res.status(500).send("Error blocking user");
  }
});

router.post("/block-reader/:id",authMiddleware,async(req,res)=>{
  try{
    await User.findByIdAndUpdate(req.params.id,{isBlocked:true});
    res.redirect("/manage-reader");
  }catch(error){
    console.log(error);
    res.status(500).send("Error blocking user");
  }
});

router.post("/unblock-reader/:id",authMiddleware,async(req,res)=>{
  try{
    await User.findByIdAndUpdate(req.params.id,{isBlocked:false});
    res.redirect("/manage-reader");
  }catch(error){ 
    console.log(error);
    res.status(500).send("Error blocking user");
  }
});

module.exports=router;