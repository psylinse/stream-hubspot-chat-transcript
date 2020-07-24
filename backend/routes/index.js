const express = require('express');
const router = express.Router();
const StreamChat = require('stream-chat');
const { default: Axios } = require('axios');
require('dotenv').config();

const apiKey = process.env.STREAM_API_KEY;
const apiSecret = process.env.STREAM_API_SECRET;
const hubspotKey = process.env.HUBSPOT_API_KEY

//CREATE A CUSTOMER IN HUBSPOT
async function createHubspotContact(firstName, lastName, email) {

  let hubspotContact = await Axios.post(`https://api.hubapi.com/crm/v3/objects/contacts?hapikey=${hubspotKey}`,
    {
      properties: {
        'firstname': firstName,
        'lastname': lastName,
        'email': email,
      }
    })
  return hubspotContact.data.id
}

function createUsers(firstName, lastName) {
  const customer = {
    id: `${firstName}-${lastName}`.toLowerCase(),
    name: firstName,
    role: 'user',
  };

  const supporter = {
    id: 'adminId',
    name: 'unique-admin-name',
    role: 'admin'
  }
  return [customer, supporter]
}

router.post('/registrations', async (req, res, next) => {
  try {
    const firstName = req.body.firstName.replace(/\s/g, '_');
    const lastName = req.body.lastName.replace(/\s/g, '_');
    const email = req.body.email.toLowerCase()
    const hubspotCustomerId = await createHubspotContact(firstName, lastName, email)

    const client = new StreamChat.StreamChat(apiKey, apiSecret);

    [customer, supporter] = createUsers(firstName, lastName)

    await client.upsertUsers([
      customer,
      supporter
    ]);

    const channel = client.channel('messaging', hubspotCustomerId, {
      members: [customer.id, supporter.id],
    });

    const customerToken = client.createToken(customer.id);

    res.status(200).json({
      customerId: customer.id,
      customerToken,
      channelId: channel.id,
      apiKey,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/webhooks', async (req, res, next) => {
  if (req.body.type === 'message.new') {
    try {
      var newMessage = req.body.message
      var hubspotCustomerId = req.body.channel_id

      await Axios
        .get(`https://api.hubapi.com/crm/v3/objects/contacts/${hubspotCustomerId}`, {
          params: {
            properties: 'chat_transcript',
            archived: false,
            hapikey: hubspotKey,
          }
        })

        .then(async (res) => {
          let localTranscript = res.data.properties.chat_transcript
          let updatedTranscript = `${localTranscript}\n FROM: ${newMessage.user.id}\n SENT AT: ${newMessage.created_at}\n MESSAGE: ${newMessage.text}`

          await Axios
            .patch(`https://api.hubapi.com/crm/v3/objects/contacts/${hubspotCustomerId}?hapikey=${hubspotKey}`, {
              properties: {
                'chat_transcript': updatedTranscript,
              }
            })
            .catch((e) => console.log('Unable to update Chat transcript', e))
        }
        )
        .catch((e) => console.log('Customer not found in HubSpot CRM: ', e))
    }

    catch (err) {
      console.log('Webhook did not respond properly', err)
      res.status(200).end()
    }
  }

  res.status(200).end()
})
module.exports = router;

