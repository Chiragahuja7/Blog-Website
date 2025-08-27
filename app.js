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


const app = express();
const PORT = 5000 || process.env.PORT;

connectDB();

app.use(express.urlencoded({extended:true}));
app.use(express.json());
app.use(cookieParser());
app.use(methodOverride('_method'));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/"); // folder to save images
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname)); // unique name
  }
});

const upload = multer({ storage: storage });

app.use('/uploads', express.static('uploads'));

app.get("/add-blog",(req,res)=>{
    res.render("form.ejs");
})


app.post("/add-blog", upload.single("image"), async (req, res) => {
  try {
    const { title, content } = req.body;
    const imagePath = req.file ? "/uploads/" + req.file.filename : null;

    const newBlog = new Post({
      title,
      body:content,
      image: imagePath   // ✅ store image path
    });

    await newBlog.save();
    res.redirect("/");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error saving blog");
  }
});

app.use(session({
    secret:'keyboard cat',
    resave:'false',
    saveUninitialized:true,
    store:MongoStore.create({
        mongoUrl:process.env.MONGODB_URI
    })
}))

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