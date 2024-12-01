import express from "express";
import http, { request } from "http";
import { Server } from "socket.io";
import { MongoClient, ServerApiVersion, UUID } from "mongodb";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { v4 } from "uuid";
import cors from "cors";

const app = express();
const server = http.createServer(app);
app.use(express.json());
app.use(cors());
const port = 3001;

const uri = process.env.MONGODB_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const io = new Server(server, {
  cors: { origin: "http://localhost:3000/" },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } catch (e) {
    console.log(e);
  }
}
run().catch(console.dir);

const chatApp = client.db("chatApp");
const users = chatApp.collection("users");
const rooms = chatApp.collection("rooms");
const authenticator = async (request, response, next) => {
  const jwtToken = request.headers["authorization"].split(" ")[1];
  if (!jwtToken) {
    response.status(401);
    response.send({ err: "can not find jwtToken" });
  } else {
    jwt.verify(jwtToken, "SECRET_KEY", async (err, payload) => {
      if (err || !(await users.findOne({ userId: payload.userId }))) {
        response.status(401);
        response.send({ err: "Invalid jwtToken" });
      } else {
        request.payload = payload;
        next();
      }
    });
  }
};
app.get("/", (request, response) => {
  response.send({ msg: "hi" });
});
app.post("/test", (request, response) => {
  response.send(request.body);
});
app.post("/login", async (request, response) => {
  const { username, password } = request.body;
  const user = await users.findOne({ userName: username });
  if (!user) {
    response.status(400);
    response.send({ err: "User not registered" });
  } else if (!(await bcrypt.compare(password, user.password))) {
    response.status(400);
    response.send({ err: "Incorrect password" });
  } else {
    const payload = { userId: user.userId };
    const jwtToken = jwt.sign(payload, "SECRET_KEY");
    response.status(200);
    response.send({ jwtToken });
  }
});
app.post("/register", async (request, response) => {
  const { username, password } = request.body;
  console.log(request.body);
  const user = await users.findOne({ userName: username });
  console.log(user);
  if (user) {
    response.status(400);
    response.send({ err: "User already exists" });
  } else {
    console.log(password);
    const hashedPassword = await bcrypt.hash(password, 10);
    const globalRoom = await rooms.findOne({ roomName: "Global" });
    if (!globalRoom) {
      const globalRoomId = v4();
      await rooms.insertOne({
        roomId: globalRoomId,
        roomName: "Global",
        type: "group",
        imgUrl: null,
        users: [],
        messages: [],
      });
    }
    const userId = v4();
    await users.insertOne({
      userId: userId,
      userName: username,
      password: hashedPassword,
      online: false,
      profileImgUrl: null,
      rooms: [globalRoom.roomId],
    });
    const newUserList = [...globalRoom.users, userId];
    await rooms.updateOne(
      { roomName: "Global" },
      { $set: { users: newUserList } }
    );
    const payload = { userId };
    const jwtToken = jwt.sign(payload, "SECRET_KEY");
    response.status(200);
    response.send({ jwtToken });
  }
});
app.get("/users", async (request, response) => {
  const list = await users.find().toArray();
  response.send(list);
});
app.get("/rooms", authenticator, async (request, response) => {
  const { userId } = request.payload;
  const user = await users.findOne({ userId });
  const list = await rooms.find().toArray();
  response.send(list.filter((e) => user.rooms.includes(e.roomId)));
});
app.get("/profile", authenticator, async (request, response) => {
  const { userId } = request.payload;
  const user = await users.findOne({ userId });
  response.status(200);
  response.send(user);
});
app.get("/onlineUsers", async (request, response) => {
  const list = await users.find({ online: true }).toArray();
  response.send(list);
  console.log(list, "request onlineUsers");
});
app.put(
  "/users/updateOnline/:userId",
  authenticator,
  async (request, response) => {
    const { userId } = request.params;
    const { online } = request.body;
    await users.updateOne({ userId: userId }, { $set: { online: online } });
    response.status(200);
    response.send({ msg: "updated successfully" });
  }
);
app.get("/roomsList", async (request, response) => {
  response.send(await rooms.find().toArray());
});
app.delete("/users", async (request, response) => {
  await users.deleteMany();
  const list = await users.find().toArray();
  response.send({ msg: "successsfully deleted", list });
});
app.delete("/rooms", async (request, response) => {
  await rooms.deleteMany();
  const list = await rooms.find().toArray();
  response.send({ msg: "successfully deleted", list });
});
app.post("/rooms/private", async (request, response) => {
  const { roomName, imgUrl, userId, friendId, type } = request.body;
  const roomId = v4();
  const usersList = userId !== undefined ? [userId, friendId] : [];
  if (roomName === "Global") {
    response.status(400);
    response.send({ err: "Global is reserved name" });
  }
  await rooms.insertOne({
    roomId,
    roomName,
    imgUrl: imgUrl !== undefined ? imgUrl : null,
    users: usersList,
    type,
    messages: [],
  });

  const user = await users.findOne({ userId });
  const friend = await users.findOne({ userId: friendId });
  console.log(user);
  console.log(friend);
  await users.updateOne(
    { userId },
    { $set: { rooms: [...user.rooms, roomId] } }
  );
  await users.updateOne(
    { userId: friendId },
    { $set: { rooms: [...friend.rooms, roomId] } }
  );

  const room = await rooms.findOne({ roomId });
  response.send(room);
});
app.get("/rooms/:roomId/messages", async (request, response) => {
  const { roomId } = request.params;
  const room = await rooms.findOne({ roomId });
  response.send(room.messages);
});
app.put("/rooms/:roomId/updateMessageList", async (request, response) => {
  const { roomId } = request.params;
  const { messageList } = request.body;
  if (messageList.length > 0) {
    const room = await rooms.findOne({ roomId });
    const oldMessageList = room.messageList;
    const idx = messageList.findIndex(
      (e) => e.id === oldMessageList[oldMessageList.length - 1].id
    );
    const newMessageList =
      idx !== -1
        ? [...oldMessageList, ...messageList.slice(idx + 1)]
        : [...oldMessageList, ...messageList];
    await rooms.updateOne({ roomId }, { $set: { messages: newMessageList } });
    const updatedRoom = await rooms.findOne({ roomId });
    response.send({ msg: "updated successfully", list: updatedRoom.messages });
  } else {
    response.send({ msg: "nothing to update" });
  }
});
app.delete("/rooms/:roomName", async (request, response) => {
  const { roomName } = request.params;
  await rooms.deleteOne({ roomName });
  response.send({ msg: `deleted roomName: ${roomName}` });
});

io.on("connection", (socket) => {
  console.log("yo");
  socket.on("connectRooms", (roomsList) => {
    console.log(roomsList, socket.id);
    roomsList.forEach((element) => {
      socket.join(element.roomId);
    });
  });
  socket.on("send-message", async (msgObj, roomId) => {
    console.log(roomId, socket.id);
    socket.to(roomId).emit("receive-message", msgObj, roomId);
    const room = await rooms.findOne({ roomId });
    const idx = room.messages.findIndex((e) => e.id === msgObj.id);
    if (idx === -1) {
      await rooms.updateOne(
        { roomId },
        { $set: { messages: [...room.messages, msgObj] } }
      );
    }
    console.log(msgObj);
  });
  socket.on("userDisconnect", async (profile) => {
    socket.broadcast.emit("userDisconnect", profile);
    await users.updateOne(
      { userId: profile.userId },
      { $set: { online: false } }
    );
    const onlineUsers = await users.find({ online: false }).toArray();
    console.log(onlineUsers, "userDisconnect");
  });
  socket.on("userConnect", async (profile) => {
    socket.broadcast.emit("userConnect", profile);
    await users.updateOne(
      { userId: profile.userId },
      { $set: { online: true } }
    );
    const onlineUsers = await users.find({ online: true }).toArray();
    console.log(onlineUsers, "userConnect");
  });
});

// const io = new Server(server, { cors: { origin: "http://localhost:3000" } });

// io.on("connection", (socket) => {
//   console.log("yo");
//   socket.on("connectRooms", (roomsList) => {
//     console.log(roomsList, socket.id);
//     roomsList.forEach((element) => {
//       socket.join(element.roomId);
//     });
//   });
//   socket.on("send-message", (msgObj, roomId) => {
//     console.log(roomId, socket.id);
//     socket.broadcast.emit("receive-message", msgObj, roomId);
//     console.log(msgObj);
//   });
//   socket.on("userDisconnect", (profile) => {
//     socket.broadcast.emit("userDisconnect", profile);
//   });
//   socket.on("userConnect", (profile) => {
//     socket.broadcast.emit("userConnect", profile);
//   });
// });

server.listen(port, () => console.log(`started on port ${port}`));

process.on("SIGINT", async () => {
  console.log("Gracefully shutting down...");
  try {
    await client.close(); // Close MongoDB connection
    console.log("MongoDB connection closed");
    process.exit(0); // Exit the process
  } catch (err) {
    console.error("Error while closing MongoDB connection", err);
    process.exit(1); // Exit with failure code
  }
});

process.on("SIGTERM", async () => {
  console.log("Received SIGTERM, shutting down gracefully...");
  try {
    await client.close();
    console.log("MongoDB connection closed");
    process.exit(0);
  } catch (err) {
    console.error("Error while closing MongoDB connection", err);
    process.exit(1);
  }
});
