const multer = require("multer");
const path = require("path");

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
const express=require("express");
const router=express.Router();
const Post = require('../models/post');
const User = require('../models/User');
const bcrypt=require("bcrypt");
const jwt =require("jsonwebtoken");
require("dotenv").config();

const adminLayout='../views/layouts/admin';
const jwtSecret=process.env.JWT_SECRET;

const authMiddleware = (req, res, next ) => {
  const token = req.cookies.token;
  try {
  console.log("Token",token)
  if(!token) {
    return res.status(401).json( { message: 'Unauthorized'} );
  }

    const decoded = jwt.verify(token, jwtSecret);
    req.user = { _id: decoded.userId }; 
    next();
  } catch(error) {
    res.status(401).json( { message: 'Unauthorized'} );
  }
}


router.get('/admin', async (req, res) => {
  try {
    const locals = {
      title: "Admin",
      description: "Simple Blog created with NodeJs, Express & MongoDb."
    }

    res.render('admin/index', { locals, layout: adminLayout });
  } catch (error) {
    console.log(error);
  }
});



router.post('/admin', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const user = await User.findOne( { email } );

    if(!user) {
      return res.status(401).json( { message: 'Invalid credentials' } );
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if(!isPasswordValid) {
      return res.status(401).json( { message: 'Invalid credentials' } );
    }

    const token = jwt.sign({ userId: user._id}, jwtSecret );
    res.cookie('token', token, { httpOnly: true });

    if(user.isAdmin){
      res.redirect('/dashboard');
    }

  } catch (error) {
    console.log(error);
  }
});


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


router.get('/dashboard', authMiddleware, async (req, res) => {
  try {
    const locals = {
      title: 'Dashboard',
      description: 'Simple Blog created with NodeJs, Express & MongoDb.'
    }

    const data = await Post.find();
    res.render('admin/dashboard', {
      locals,
      data,
      layout: adminLayout
    });

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
      layout: adminLayout
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

    res.redirect(`/dashboard`);

  } catch (error) {
    console.log(error);
  }

});

router.delete('/delete-post/:id', authMiddleware, async (req, res) => {

  try {
    await Post.deleteOne( { _id: req.params.id } );
    res.redirect('/dashboard');
  } catch (error) {
    console.log(error);
  }

});

router.get('/logout', (req, res) => {
  res.clearCookie('token');
  res.redirect('/');
});




// router.get("/signup",(req,res)=>{
//   res.render("
// })

module.exports=router;