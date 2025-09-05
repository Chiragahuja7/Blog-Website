const mongoose = require('mongoose');

const Schema = mongoose.Schema;
const UserSchema = new Schema({
  firstname: {
    type: String,
    required: true,
  },
  lastname: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
    unique: true
  },
  password: {
    type: String,
    required: true
  },
  isAdmin: {
    type: Boolean,
    default: false
  },
  // status:{
  //   type:String,
  //   default:"pending"
  // },
  blogLimit:{
    type:Number,
    default:5
  },
  blogsPosted:{
    type:Number,
    default:0
  },  
  hasPaid:{
    type:Boolean,
    default:false
  },
  processedSessions: {
  type: [String],
  default: []
  }
});

module.exports = mongoose.model('User', UserSchema);
