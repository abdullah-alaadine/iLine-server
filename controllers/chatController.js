const { default: mongoose } = require("mongoose");
const Chat = require("../models/chatModel");
const { moreThanTwoMembers } = require("../utils/validateGroupMembers");
const messageModel = require("../models/messageModel");

const createChat = async (req, res) => {
  const { members, name, isGroup } = req.body;
  let uniqueMembers;
  try {
    uniqueMembers = moreThanTwoMembers(req, members);
    uniqueMembers = [...uniqueMembers];
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  try {
    let chat;
    if (isGroup) {
      if (!name)
        return res.status(400).json({ error: "You must add a group name" });
      const messagesDeletedAt = uniqueMembers.map((member) => ({
        userId: member,
      }));
      chat = await Chat.create({
        members: uniqueMembers,
        isGroup,
        groupAdmin: req.user._id,
        name,
        messagesDeletedAt,
      });
      chat = await chat.populate({
        path: "members",
        select: "firstName lastName profilePicture _id",
        match: { _id: { $ne: req.user._id } },
      });
      return res.status(201).json(chat);
    }
    const chatExists = await Chat.findOne({
      members: { $all: uniqueMembers },
      isGroup: false,
    });
    if (chatExists)
      return res.status(400).json({ error: "This chat is already created" });
    const messagesDeletedAt = uniqueMembers.map((member) => ({
      userId: member,
    }));
    chat = await Chat.create({
      members: uniqueMembers,
      messagesDeletedAt,
    });
    chat = await chat.populate({
      path: "members",
      select: "firstName lastName profilePicture _id",
      match: { _id: { $ne: req.user._id } },
    });
    res.status(201).json(chat);
  } catch (error) {
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

const deleteChat = async (req, res) => {
  const { chatId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(chatId))
    return res.status(400).json({ error: "Invalid Id" });
  try {
    let deletedChat = await Chat.findById(chatId);
    if (deletedChat.isGroup && deletedChat.groupAdmin != req.user._id)
      return res.status(403).json({ error: "You are not the group admin!" });
    deletedChat = await Chat.findByIdAndDelete(chatId);
    if (!deletedChat) return res.status(400).json({ error: "no such chat" });
    res.status(200).json(deletedChat);
  } catch (error) {
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

const getChats = async (req, res) => {
  try {
    let chats = await Chat.find({ members: { $in: [req.user._id] } })
      .sort({ updatedAt: -1 })
      .populate({
        path: "members",
        select: "firstName lastName profilePicture _id about email",
        match: { _id: { $ne: req.user._id } },
      });
    const updatedChats = [];
    const clearedChats = [];
    for (const chat of chats) {
      if (
        (chat.lastMessage.getTime() < chat.createdAt.getTime() &&
          chat.createdAt.getTime() == chat.updatedAt.getTime()) ||
        chat.isGroup
      ) {
        updatedChats.push(chat);
      } else {
        const deletedAt = chat.messagesDeletedAt.filter(
          (elem) => elem.userId == req.user._id
        )[0].date;
        const messages = await messageModel.find({
          chatId: chat._id,
          createdAt: { $gt: deletedAt },
        });
        if (messages.length) {
          updatedChats.push(chat);
        } else {
          clearedChats.push(chat._id);
        }
      }
    }

    res.status(200).json({ updatedChats, clearedChats });
  } catch (error) {
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

const clearChat = async (req, res) => {
  const { chatId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(chatId))
    return res.status(400).json({ error: "Invalid Id" });
  try {
    let chat = await Chat.findById(chatId);
    const userIndex = chat.messagesDeletedAt.findIndex(
      (user) => user.userId == req.user._id
    );
    if (userIndex >= 0) {
      chat.messagesDeletedAt[userIndex].date = new Date();
      await chat.save();
    }
    res.status(200).json(chat);
  } catch (error) {
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

const getChat = async (req, res) => {
  const { chatId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(chatId))
    return res.status(400).json({ error: "Invalid Id" });
  try {
    const chat = await Chat.findById(chatId).populate({
      path: "members",
      select: "firstName lastName profilePicture _id about email",
      match: { _id: { $ne: req.user._id } },
    });
    if (!chat) return res.status(404).json({ error: "No such chat" });
    res.status(200).json(chat);
  } catch (error) {
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

const updateGroup = async (req, res) => {
  const { chatId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(chatId))
    return res.status(400).json({ error: "Invalid Id" });
  const { members, name, groupPicture } = req.body;
  let uniqueMembers;
  try {
    uniqueMembers = moreThanTwoMembers(req, members);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  try {
    const chat = await Chat.findById(chatId);
    if (!chat.isGroup)
      return res.status(400).json({
        error: "this chat is not a group chat, you can delete the whole chat",
      });
    if (!name)
      return res.status(400).json({ error: "You must add a group name" });
    if (chat.groupAdmin != req.user._id)
      return res
        .status(401)
        .json({ error: "you don't have the access the add or delete members" });
    const newChat = await Chat.findByIdAndUpdate(
      chatId,
      { members: [...uniqueMembers], name, groupPicture },
      { new: true }
    ).populate({
      path: "members",
      select: "firstName lastName profilePicture _id",
      match: { _id: { $ne: req.user._id } },
    });
    res.status(200).json(newChat);
  } catch (error) {
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

const leaveGroup = async (req, res) => {
  const { chatId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(chatId))
    return res.status(400).json({ error: "Invalid Id" });
  try {
    const chat = await Chat.findById(chatId);
    if (!chat) return res.status(404).json({ error: "No such chat" });
    if (!chat.isGroup)
      return res.status(400).jso({ error: "This chat isn't a group chat" });
    if (chat.groupAdmin == req.user._id)
      return res
        .status(400)
        .json({ error: "You are the admin! You can delete this chat instead" });
    chat.members = chat.members.filter((user) => user._id != req.user._id);
    await chat.save();
    res.status(200).json(chat);
  } catch (error) {
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

module.exports = {
  createChat,
  deleteChat,
  getChats,
  updateGroup,
  getChat,
  clearChat,
  leaveGroup,
};
