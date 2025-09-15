require("dotenv").config();

const express=require("express");
const expressLayouts=require("express-ejs-layouts")
const methodOverride = require("method-override");
const connectDB=require("./server/config/db");
const cookieParser=require("cookie-parser");
const session=require("express-session");
const MongoStore=require("connect-mongo");
const {isActiveRoute}=require("./server/helpers/routeHelpers")
const multer = require("multer");
const path = require("path");
const Post = require("./server/models/post");
const stripe=require("stripe")(process.env.STRIPE_SECRET_KEY);
const Razorpay = require('razorpay');
const crypto = require('crypto');
const cors = require('cors');


const app = express();
const PORT = process.env.PORT || 5000;
app.use(cors());

connectDB();

app.use(session({
    secret: 'keyboard cat',
    resave: false,
    saveUninitialized: true,
    store: MongoStore.create({
      mongoUrl: process.env.MONGODB_URI
    })
}));

// allow larger payloads from rich-text editors (images as base64 or long HTML)
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(methodOverride('_method'));

function checkBlogLimit(req, res, next) {
  if (!req.session.user) {
    return res.status(401).send("You must be logged in to post a blog.");
  }
  const User = require('./server/models/User');
  User.findById(req.session.user._id)
    .then(user => {
      if (!user) {
        return res.status(401).send("User not found.");
      }
      if (user.blogsPosted >= user.blogLimit) {
       return res.render("editor.ejs", { 
       data: [],
       current: 1,
       nextPage: null,
       prevPage: null,
       totalPages: 1,
       error: "Blog post limit reached. Please upgrade your plan to post more blogs.",
       upgradeLink: "/checkout"
       });
      }
      req.dbUser = user;
      next();
    })
    .catch(err => {
      console.error(err);
      return res.status(500).send("Internal server error.");
    });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
}); 

const upload = multer({ storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }
});

app.post('/upload', upload.any(), (req, res) => {
  // multer `any()` accepts files with any field name which is robust for editor uploads
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ success: false, message: 'No files uploaded' });
  }
  const fileUrls = req.files.map(file => `/uploads/${file.filename}`);

  res.json({
    success: true,
    files: fileUrls
  });
});

app.use('/uploads', express.static('uploads'));

app.get("/add-blog",(req,res)=>{
    res.render("form.ejs" ,{data:{}});
})

app.post("/add-blog",checkBlogLimit, upload.array("images",3), async (req, res) => {
  try {
    const { title, content } = req.body;
    const imagePaths = req.files ? req.files.map(file => "/uploads/" + file.filename) : [];
    const user = req.dbUser;
    if (!user) {
      return res.status(401).send("User not found.");
    }
    const newBlog = new Post({
      title,
      body: content,
      image: imagePaths,
      category: req.body.category,
      author: user._id,
      isProBlog: req.body.isProBlog === 'true' || req.body.isProBlog === 'on' 
    });
    await newBlog.save();
    user.blogsPosted += 1;
    await user.save();
    res.redirect("/editor");
    
  } catch (err) {
    console.error(err);
    res.status(500).send("Error saving blog");
  }
})

// make user available in all EJS templates
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

app.use(express.static("public"));

app.use(expressLayouts);
app.set('layout',"layouts/main");
app.set('view engine', 'ejs');

app.locals.isActiveRoute=isActiveRoute;

app.use("/" ,require('./server/routes/main'));
app.use("/",require('./server/routes/admin'))

app.listen(PORT , ()=> {
    console.log(`Listening on port ${PORT}`)
});
