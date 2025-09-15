const mongoose = require('mongoose');

const Schema = mongoose.Schema;
const PostSchema = new Schema({
  title: {
    type: String,
    required: true
  },
  body: {
    type: String,
    required: true
  },
  image: {          
    type: [String]
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  status:{
    type:String,
    default:"pending"
  },
  category:{
    type:String,
    default: "uncategorized"
  },
  author: {
  type: mongoose.Schema.Types.ObjectId,
  ref: 'User',
  required: true
  },
  isProBlog:{
    type:Boolean,
    default:false
  }
}); 

module.exports = mongoose.model('Post', PostSchema);