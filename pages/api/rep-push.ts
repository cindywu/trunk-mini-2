import { getDB } from '../../db.js'
import Pusher from 'pusher'

// eslint-disable-next-line import/no-anonymous-default-export
export default async (req: any, res: any) => {
  const push = req.body
  console.log('Processing push', JSON.stringify(push, null, ''))

  const t0 = Date.now()

  try {
    const db = await getDB()
    await db.tx(async t => {
      const {nextval: version} = await db.one("SELECT nextval('version')")
      let lastMutationID = parseInt(
        (
          await db.oneOrNone(
            'SELECT last_mutation_id FROM trunk_mini_replicache_client WHERE id = $1',
            push.clientID
          )
        )?.last_mutation_id ?? '0',
      )

      if (!lastMutationID) {
        await db.none(
          'INSERT INTO trunk_mini_replicache_client (id, last_mutation_id) VALUES ($1, $2)',
          [push.clientID, lastMutationID]
        )
      }
      console.log('version:', version, 'lastMutationID:', lastMutationID)

      for (let i = 0; i < push.mutations.length; i++) {
        const t1 = Date.now();

        const mutation = push.mutations[i]
        const expectedMutationID = lastMutationID + 1

        if (mutation.id < expectedMutationID) {
          console.log(
            `Mutation ${mutation.id} has already been processed - skipping`,
          )
          continue
        }
        if (mutation.id > expectedMutationID) {
          console.warn(`Mutation ${mutation.id} is from the future - aborting`)
          break
        }

        console.log('Procesing mutation:', JSON.stringify(mutation, null, ''))

        switch (mutation.name) {
          case 'createReference':
            await createReference(db, mutation.args, version)
            break
          default:
            throw new Error(`Unknown mutation: ${mutation.name}`)
        }
        lastMutationID = expectedMutationID
        console.log('Processed mutation in', Date.now() - t1)
      }
      await sendPoke()
      console.log(
        'setting',
        push.clientID,
        'last_mutation_id to',
        lastMutationID,
      )
      await db.none(
        'UPDATE trunk_mini_replicache_client SET last_mutation_id = $2 WHERE id = $1',
        [push.clientID, lastMutationID],
      )
      res.send('{}')
    })
  } catch (e) {
    console.error(e)
    res.status(500).send(e.toString())
  } finally {
    console.log('Processed push in', Date.now() - t0)
  }
}

async function createReference(db: any, {id, abbreviation, title, order}: any, version: any) {
  await db.none(
    `INSERT INTO trunk_mini (
      id, abbreviation, title, ord, version) values
      ($1, $2, $3, $4, $5)`,
      [id, abbreviation, title, order, version],
  )
}

async function sendPoke() {
  const pusher = new Pusher({
    appId: process.env.NEXT_PUBLIC_TRUNK_MINI_PUSHER_APP_ID!,
    key: process.env.NEXT_PUBLIC_TRUNK_MINI_PUSHER_KEY!,
    secret: process.env.NEXT_PUBLIC_TRUNK_MINI_PUSHER_SECRET!,
    cluster: process.env.NEXT_PUBLIC_TRUNK_MINI_PUSHER_CLUSTER!,
    useTLS: true,
  })
  const t0 = Date.now()
  await pusher.trigger('default', 'poke', {})
  console.log('Sent poke in', Date.now() - t0)
}