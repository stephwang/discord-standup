import express from 'express'
import dotenv from 'dotenv'
import fetch from 'node-fetch'
import {validateBody} from './validators.js'
import expressWs from 'express-ws'
import {z} from 'zod'
import path from "path";
import { fileURLToPath } from "url";
dotenv.config({ path: "../.env" });

const state = {};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appWs = expressWs(express());
const app = appWs.app;
const port = process.env.PORT || 3001;
const COUNTDOWN_SECONDS_MS = 5000;

app.use(express.static(path.join(__dirname, "app/dist")));

app.get("*", function (_req, res) {
  res.sendFile(path.join(__dirname, "app/dist", "index.html"));
});

async function validateInstance(instanceId) {
  // validate activity instance exists
  const validateResponse = await fetch(
    `https://discord.com/api/applications/${process.env.VITE_DISCORD_CLIENT_ID}/activity-instances/${instanceId}`,
    {
      headers: {
        method: 'GET',
        Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
      },
    }
  )

  if (validateResponse.status !== 200) {
    console.log('validate instance error:', validateResponse.status, validateResponse.headers.raw())
  }

  return validateResponse.status === 200
}

// Allow express to parse JSON bodies
app.use(express.json())

app.post(
  '/api/token',
  validateBody(
    z.object({
      code: z.string(),
      instanceId: z.string(),
    })
  ),
  async (req, res) => {
    // TODO: also gate with check for activity existing, just have one shared middleware or w/e
    const valid = await validateInstance(req.body.instanceId)
    if (!valid) {
      return res.status(400).json({error: 'Invalid instance'})
    }

    const response = await fetch(`https://discord.com/api/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: process.env.VITE_DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: req.body.code,
      }),
    })

    const {access_token} = await response.json()
    res.send({access_token})
  }
)

function broadcastState(instanceId) {
  if (state[instanceId] == null) {
    return
  }

  state[instanceId].connections.forEach(connection => {
    connection.send(
      JSON.stringify({
        type: 'state',
        state: {
          members: state[instanceId].members,
          startedAt: state[instanceId].startedAt,
          duration: state[instanceId].duration,
          isPaused: state[instanceId].isPaused || false,
          pausedAt: state[instanceId].pausedAt || null,
          currentOffset:
            state[instanceId].startedAt == null
              ? 0
              : (state[instanceId].isPaused ? state[instanceId].pausedAt : new Date()) - state[instanceId].startedAt,
        },
      })
    )
  })
}

app.ws('/api/ws/:instanceId', async (ws, req) => {
  const instanceId = req.params.instanceId

  if (state[instanceId] == null) {
    state[instanceId] = {
      connections: [ws],
      members: [],
      startedAt: null,
      duration: null,
    }
  } else {
    state[instanceId].connections.push(ws)
  }

  ws.on('message', msg => {
    if (state[instanceId] == null) {
      return
    }

    const parsed = JSON.parse(msg)
    console.log('ws message received:', parsed)

    if (parsed.type === 'join') {
      /*
      {
        type: "join",
        userId: "123",
      }
      */
      if (state[instanceId].members.includes(parsed.userId)) {
        return
      }

      ws.userId = parsed.userId
      state[instanceId].members.push(parsed.userId)
      broadcastState(instanceId)
    } else if (parsed.type === 'leave') {
      /*
      {
        type: "leave",
        userId: "123",
      }
      */
      if (!state[instanceId].members.includes(parsed.userId) || state[instanceId].startedAt != null) {
        return
      }

      state[instanceId].members = state[instanceId].members.filter(member => member !== parsed.userId)
      broadcastState(instanceId)
    } else if (parsed.type === 'start') {
      /*
      {
        type: "start",
        duration: 15,
      }
      */
      if (state[instanceId].startedAt != null || state[instanceId].members.length === 0) {
        return
      }

      state[instanceId].startedAt = new Date(Date.now() + COUNTDOWN_SECONDS_MS)
      state[instanceId].duration = parsed.duration ?? 30
      state[instanceId].members = state[instanceId].members.toSorted(() => Math.random() - 0.5)

      broadcastState(instanceId)
    } else if (parsed.type === 'pause') {
      /*
      {
        type: "pause",
      }
      */
      if (state[instanceId].startedAt == null || state[instanceId].isPaused) {
        return
      }

      state[instanceId].isPaused = true
      state[instanceId].pausedAt = new Date()
      broadcastState(instanceId)
    } else if (parsed.type === 'resume') {
      /*
      {
        type: "resume",
      }
      */
      if (state[instanceId].startedAt == null || !state[instanceId].isPaused) {
        return
      }
      const pauseDuration = new Date() - state[instanceId].pausedAt
      state[instanceId].startedAt = new Date(state[instanceId].startedAt.getTime() + pauseDuration)
      state[instanceId].isPaused = false
      state[instanceId].pausedAt = null
      broadcastState(instanceId)
    } else if (parsed.type === 'skip') {
      /*
      {
        type: "skip",
      }
      */
      if (state[instanceId].startedAt == null) {
        return
      }

      const now = state[instanceId].isPaused ? state[instanceId].pausedAt : new Date()
      const elapsed = now - state[instanceId].startedAt
      const durationMs = state[instanceId].duration * 1000
      const currentIndex = Math.floor(elapsed / durationMs)

      if (currentIndex + 1 >= state[instanceId].members.length) {
        // no more members to skip to
        return
      }

      // move startedAt by time remaining for current speaker
      state[instanceId].startedAt = new Date(
        state[instanceId].startedAt.getTime() - (durationMs - (elapsed % durationMs))
      )
      broadcastState(instanceId)
    } else if (parsed.type === 'reset') {
      /*
      {
        type: "reset",
      }
      */
      state[instanceId].startedAt = null
      state[instanceId].duration = null
      broadcastState(instanceId)
    } else if (parsed.type === 'popcorn') {
      /*
      {
        type: "popcorn",
        x: 0.23,
        y: 0.45,
      }
      */
      state[instanceId].connections.forEach(connection => {
        connection.send(
          JSON.stringify({
            type: 'popcorn',
            x: parsed.x,
            y: parsed.y,
          })
        )
      })
    } else if (parsed.type === 'echo') {
      ws.send(
        JSON.stringify({
          type: 'echo',
          message: parsed,
        })
      )
    }
  })

  ws.on('close', () => {
    if (state[instanceId] == null) {
      return
    }

    state[instanceId].connections = state[instanceId].connections.filter(connection => connection !== ws)

    // if standup is running and someone leaves, keep them in the list so order doesnt break
    if (state[instanceId].startedAt == null) {
      state[instanceId].members = state[instanceId].members.filter(member => member !== ws.userId)
    }

    if (state[instanceId].connections.length === 0) {
      delete state[instanceId]
    }
    broadcastState(instanceId)
  })

  const valid = await validateInstance(instanceId)
  if (!valid) {
    ws.close()
  }
})

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`)
})
