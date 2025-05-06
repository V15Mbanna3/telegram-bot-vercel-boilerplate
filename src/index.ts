// src/index.js
const { Telegraf, Scenes, session } = require('telegraf')
const { GoogleSpreadsheet } = require('google-spreadsheet')
require('dotenv').config()

// تكوين التوكنات من متغيرات البيئة
const BOT_TOKEN = process.env.BOT_TOKEN
const ADMIN_ID = process.env.ADMIN_ID
const SHEET_ID = process.env.SHEET_ID
const CREDS = JSON.parse(process.env.GOOGLE_CREDS)

// تهيئة البوت والجداول
const bot = new Telegraf(BOT_TOKEN)
const doc = new GoogleSpreadsheet(SHEET_ID)

// 1. تسجيل بيانات المستخدم
const registerWizard = new Scenes.WizardScene(
  'register',
  async (ctx) => {
    await ctx.reply('مرحبا! الرجاء إرسال اسمك:')
    return ctx.wizard.next()
  },
  async (ctx) => {
    ctx.wizard.state.name = ctx.message.text
    await ctx.reply('الرجاء إرسال رقم هاتفك:')
    return ctx.wizard.next()
  },
  async (ctx) => {
    ctx.wizard.state.phone = ctx.message.text
    await ctx.reply('الرجاء إرسال معرف التليجرام الخاص بك:')
    return ctx.wizard.next()
  },
  async (ctx) => {
    ctx.wizard.state.telegram_id = ctx.message.text
    const userData = {
      ...ctx.wizard.state,
      user_id: ctx.from.id,
      voice_sent: 'لا',
      last_reminder: new Date().toISOString()
    }
    
    // حفظ البيانات في جوجل شيت
    await doc.useServiceAccountAuth(CREDS)
    await doc.loadInfo()
    const sheet = doc.sheetsByIndex[0]
    await sheet.addRow(userData)
    
    await ctx.reply('✅ تم التسجيل بنجاح!')
    return ctx.scene.leave()
  }
)

// 2. أوامر الأدمن
bot.command('broadcast', async (ctx) => {
  if (ctx.from.id.toString() !== ADMIN_ID) return
  
  await ctx.reply('أرسل الرسالة (نص/صورة/فيديو/ملف):')
  bot.on('message', async (ctx) => {
    const users = await getSheetData()
    users.forEach(async (user) => {
      try {
        if (ctx.message.text) await ctx.telegram.sendMessage(user.user_id, ctx.message.text)
        if (ctx.message.photo) await ctx.telegram.sendPhoto(user.user_id, ctx.message.photo[0].file_id)
        if (ctx.message.video) await ctx.telegram.sendVideo(user.user_id, ctx.message.video.file_id)
        if (ctx.message.document) await ctx.telegram.sendDocument(user.user_id, ctx.message.document.file_id)
      } catch (error) {
        console.error(`فشل الإرسال للمستخدم ${user.user_id}:`, error)
      }
    })
    await ctx.reply(`✅ تم الإرسال لـ ${users.length} مستخدم`)
  })
})

// 3. استقبال الفويس نوت
bot.on('voice', async (ctx) => {
  await doc.useServiceAccountAuth(CREDS)
  await doc.loadInfo()
  const sheet = doc.sheetsByIndex[0]
  const rows = await sheet.getRows()
  
  const userRow = rows.find(row => row.user_id == ctx.from.id.toString())
  if (userRow) {
    userRow.voice_sent = 'نعم'
    userRow.voice_date = new Date().toISOString()
    await userRow.save()
    await ctx.reply('✅ تم استلام الفويس نوت بنجاح!')
  }
})

// 4. التذكيرات والتقارير
async function sendReminders() {
  await doc.useServiceAccountAuth(CREDS)
  await doc.loadInfo()
  const sheet = doc.sheetsByIndex[0]
  const rows = await sheet.getRows()
  
  const pendingUsers = rows.filter(row => row.voice_sent === 'لا')
  pendingUsers.forEach(async (user) => {
    try {
      await bot.telegram.sendMessage(user.user_id, '⏰ تذكير: الرجاء إرسال الفويس نوت!')
    } catch (error) {
      console.error(`فشل إرسال تذكير للمستخدم ${user.user_id}:`, error)
    }
  })
  
  // إرسال تقرير للأدمن
  const report = `📊 تقرير الحالة:\n✅ تم الإرسال: ${rows.length - pendingUsers.length}\n❌ لم يرسل: ${pendingUsers.length}`
  await bot.telegram.sendMessage(ADMIN_ID, report)
}

// 5. إضافة أدمنز
bot.command('addadmin', async (ctx) => {
  if (ctx.from.id.toString() !== ADMIN_ID) return
  
  const newAdmin = ctx.message.text.split(' ')[1]
  await doc.useServiceAccountAuth(CREDS)
  await doc.loadInfo()
  const adminSheet = doc.sheetsByIndex[1] || (await doc.addSheet({ title: 'Admins' }))
  await adminSheet.addRow({ admin_id: newAdmin })
  
  await ctx.reply(`✅ تم إضافة الأدمن الجديد: ${newAdmin}`)
})

// وظائف مساعدة
async function getSheetData() {
  await doc.useServiceAccountAuth(CREDS)
  await doc.loadInfo()
  const sheet = doc.sheetsByIndex[0]
  return sheet.getRows()
}

// تهيئة السيناريوهات
const stage = new Scenes.Stage([registerWizard])
bot.use(session())
bot.use(stage.middleware())

// تشغيل البوت
bot.launch()
module.exports = bot
