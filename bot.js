
const Discord = require('discord.js');
const fs = require('fs');
const mathjs = require('mathjs');
const { titleCase } = require('title-case');
const fetch = require('node-fetch');
const Fuse = require('fuse.js');
const gtts = require('gtts');
const dayjs = require('dayjs');
const express = require('express');
const sqlite3 = require('better-sqlite3');
const puppeteer = require('puppeteer');
const parseHtml = require('node-html-parser');
const ytdl = require('ytdl-core');
const { randomInt, randomHex, roundSmart, isValidIp, isValidHostname, isValidUrl, overflow, getRandomElement, getRandomWeighted, formatSeconds } = require('web-resources');
const { buildCommands, initializeBot, buttonClick, modalSubmit, getBtnId, selectMenuSelect } = require('../discord-helper');
const logger = require('cyber-express-logger');

const writeJson = (file, object) => fs.writeFileSync(file, JSON.stringify(object, null, 4));

const config = require('./config.json');
const conversions = require('./conversions.json');
const languages = require('./languages.json');
const usage = require('./usage.json');
const sanitizeRegex = new RegExp(/([\[\]\{\}`\(\)<>\*])/g);
const isUserScreenshotting = {};
const ytdlUrls = {};
const wordList = (() => {
    const db = sqlite3('./dictionary.db');
    const entries = [];
    db.prepare(`SELECT word FROM word_list`).all()
        .forEach(word => entries.push(word.word));
    db.close();
    return entries;
})();

async function main() {
    // Set up web server
    const srv = express();
    srv.use(logger({ getIP: req => req.headers['cf-connecting-ip'] }));
    srv.use(express.static('./web/main'));
    srv.get('/invite', (req, res) => {
        res.redirect(config.invite_url);
    });
    srv.get('/ytdl/:id', (req, res) => {
        if (ytdlUrls[req.params.id])
            res.redirect(ytdlUrls[req.params.id]);
        else
            res.end(`That URL isn't valid!`);
    });
    srv.listen(config.port, () => {
        console.log(`Web server listening on port ${config.port}`);
    });

    // Set up short link server
    const shortener = express();
    shortener.use(express.static('./web/shortener'));
    shortener.get('/:slug', (req, res) => {
        const db = sqlite3('./shortener.db');
        const entry = db.prepare(`SELECT * FROM links WHERE slug = ?`).get(req.params.slug);
        if (!entry) {
            db.close();
            return res.end(`That short link doesn't exist!`);
        }
        if (entry.disabled) {
            db.close();
            return res.end(`This short link has been disabled by its creator.`);
        }
        db.prepare(`UPDATE links SET count_clicks = count_clicks + 1 WHERE slug = ?`).run(entry.slug);
        db.close();
        res.redirect(entry.url);
        console.log(`${req.headers['cf-connecting-ip']} clicked short link: ${entry.slug}`);
    });
    shortener.listen(config.shortener_port, () => {
        console.log(`Short link server listening on port ${config.shortener_port}`);
    });

    // Initialize bot
    let startTime;
    const intents = [
        Discord.GatewayIntentBits.Guilds,
        Discord.GatewayIntentBits.GuildMessages,
        Discord.GatewayIntentBits.GuildEmojisAndStickers,
        Discord.GatewayIntentBits.GuildMessageReactions
    ];
    const bot = await initializeBot({ intents: intents }, config.token, (me) => {
        me.user.setActivity(`for your commands`, {
            type: Discord.ActivityType.Listening
        });
        startTime = Date.now();
    });

    // Set up commands
    const commands = await buildCommands({
        ping: {
            builder: new Discord.SlashCommandBuilder()
                .setName('ping')
                .setDescription(`A test command, and a great way to make sure things are working.`),
            handler: req => {
                req.reply({ content: 'Pong!', ephemeral: true });
            }
        },
        help: {
            builder: new Discord.SlashCommandBuilder()
                .setName('help')
                .setDescription(`Get more info about Cybot, including a full list of commands and options.`),
            handler: req => {
                req.reply({ content: `Check out [the Cybot website](<https://${config.web_domain}>) for a complete list of commands and options, and read [Cybot's privacy policy](<https://${config.web_domain}/privacy>) for more info on how we use your data.`, ephemeral: true });
            }
        },
        naenae: {
            builder: new Discord.SlashCommandBuilder()
                .setName('naenae')
                .setDescription(`Nae nae on a fellow user.`)
                .addUserOption(opt => opt
                    .setName('target')
                    .setDescription(`The target user`)
                    .setRequired(true)),
            handler: req => {
                const sender = req.user.id;
                const target = req.options.getUser('target').id;
                if (sender == target) {
                    return req.reply({
                        content: `You can't nae nae on yourself!`,
                        ephemeral: true
                    });
                }
                req.reply({
                    content: `<@${sender}> nae naed on <@${target}>, STANK STANK!`,
                    allowedMentions: { users: [target] }
                });
            }
        },
        stankyleg: {
            builder: new Discord.SlashCommandBuilder()
                .setName('stankyleg')
                .setDescription(`Do the stanky leg.`),
            handler: req => {
                req.reply({
                    content: `<@${req.user.id}> did the stanky leg, STANK STANK!`,
                    allowedMentions: { users: [] }
                });
            }
        },
        rng: {
            builder: new Discord.SlashCommandBuilder()
                .setName('rng')
                .setDescription(`Generate a random number within a range.`)
                .addNumberOption(opt => opt
                    .setName('min')
                    .setDescription('The minimum value')
                    .setRequired(true)
                    .setMinValue(-Number.MAX_SAFE_INTEGER)
                    .setMaxValue(Number.MAX_SAFE_INTEGER))
                .addNumberOption(opt => opt
                    .setName('max')
                    .setDescription('The maximum value')
                    .setRequired(true)
                    .setMinValue(-Number.MAX_SAFE_INTEGER)
                    .setMaxValue(Number.MAX_SAFE_INTEGER)),
            handler: req => {
                const min = Math.min(req.options.getNumber('min'), req.options.getNumber('max'));
                const max = Math.max(req.options.getNumber('min'), req.options.getNumber('max'));
                let num;
                let i = 0;
                let history = [];
                const getContent = () => {
                    if (num) history.unshift(num);
                    while (history.length > 20) history.pop();
                    if (history.length == 20) history.push('...');
                    num = randomInt(min, max);
                    const btn = getBtnId();
                    buttonClick(btn).then(req2 => {
                        req2.deferUpdate();
                        req.editReply(getContent());
                    }).catch(() => {});
                    i++;
                    const embed = new Discord.EmbedBuilder()
                        .setAuthor({ name: `${min} .. ${max}` })
                        .setTitle(`${num}`)
                        .setColor(0xdbc557);
                    if (history.length > 0) embed.setDescription(history.join(', '));
                    return {
                        content: `Iteration ${i}`,
                        embeds: [embed],
                        components: [ new Discord.ActionRowBuilder().addComponents(...[
                            new Discord.ButtonBuilder()
                                .setCustomId(btn)
                                .setLabel(`Again`)
                                .setStyle(Discord.ButtonStyle.Primary)
                        ]) ]
                    };
                }
                req.reply(getContent());
            }
        },
        roll: {
            builder: new Discord.SlashCommandBuilder()
                .setName('roll')
                .setDescription(`Roll a dice with a set number of sides. See /dice for a more in-depth dice roll.`)
                .addNumberOption(opt => opt
                    .setName('sides')
                    .setDescription('The number of sides the dice should have [100]')
                    .setMinValue(1)
                    .setMaxValue(999999)),
            handler: (req) => {
                const max = req.options.getNumber('sides') || 100;
                const num = randomInt(1, max);
                req.reply({
                    content: `<@${req.user.id}> rolled ${num}`,
                    allowedMentions: { users: [] }
                });
            }
        },
        coinflip: {
            builder: new Discord.SlashCommandBuilder()
                .setName('coinflip')
                .setDescription(`Flip a coin.`),
            handler: (req) => {
                req.reply(`It's ${(Math.random() > 0.5) ? 'heads':'tails'}`);
            }
        },
        randomcase: {
            builder: new Discord.SlashCommandBuilder()
                .setName('randomcase')
                .setDescription(`Randomize the case of text.`)
                .addStringOption(opt => opt
                    .setName('input')
                    .setDescription('Your input text')
                    .setRequired(true)),
            handler: (req) => {
                const input = req.options.getString('input').split('');
                let result = [];
                input.forEach((char) => {
                    if (Math.random() > 0.5)
                        result.push(char.toUpperCase());
                    else
                        result.push(char.toLowerCase());
                });
                req.reply(result.join(''));
            },
        },
        calc: {
            builder: new Discord.SlashCommandBuilder()
                .setName('calc')
                .setDescription(`Calculate simple math or complex equations with variables.`)
                .addStringOption(opt => opt
                    .setName('equation')
                    .setDescription('Your equation (can include variables)')
                    .setRequired(true))
                .addStringOption(opt => opt
                    .setName('variables')
                    .setDescription('Your known variables as comma-separated key=value pairs')),
            handler: (req) => {
                // Parse input equation
                let input;
                try {
                    input = mathjs.parse(req.options.getString('equation'));
                } catch (error) {
                    return req.reply({
                        content: `Failed to parse equation!\n\`\`\`${error}\`\`\``,
                        ephemeral: true
                    });
                }
                // Split variable string by commas
                let vars = {};
                const varsRaw = req.options.getString('variables') || '';
                const varsSplit = varsRaw.split(',').filter(String);
                // Loop through variable pairs
                for (const pair of varsSplit) {
                    // Split pair by the equal sign
                    const varSplit = pair.split('=').filter(String);
                    if (varSplit.length !== 2) {
                        return req.reply({
                            content: 'Invalid input for variables!',
                            ephemeral: true
                        });
                    }
                    // Make sure hte vairable content is valid, then simplify and store it
                    try {
                        const parsed = mathjs.parse(varSplit[1]);
                        vars[varSplit[0]] = mathjs.simplify(parsed).toString();
                    } catch (error) {
                        return req.reply({
                            content: `Failed to parse variable **${varSplit[0]}**!`,
                            ephemeral: true
                        });
                    }
                }
                // Get the input equation as a formatted string
                const equation = input.toString();
                // Simplify the input
                let result = mathjs.simplify(input) || null;
                // Try to evaluate the input
                if (result) try {
                    result = result.evaluate(vars);
                } catch (error) {}
                if (result === null) return req.reply({
                    content: 'Failed to calculate!',
                    ephemeral: true
                });
                // Create embed fields
                const fields = [
                    { name: `Input`, value: `*${equation}*`, inline: true },
                ];
                if (Object.keys(vars).length > 0) {
                    let tmp = [];
                    Object.keys(vars).forEach((key) => {
                        tmp.push(`${key} = ${vars[key].toString()}`);
                    });
                    fields.push({ name: `Vars`, value: tmp.join(', '), inline: true });
                }
                fields.push({ name: `Result`, value: `${result}` });
                // Reply
                req.reply({ embeds: [
                    new Discord.EmbedBuilder()
                        .setFields(fields)
                        .setColor(0xdbc557)
                ] });
            }
        },
        items2stacks: {
            builder: new Discord.SlashCommandBuilder()
                .setName('items2stacks')
                .setDescription(`Convert an arbitrary number of items to stacks plus extra.`)
                .addNumberOption(opt => opt
                    .setName('count')
                    .setDescription('The number of items')
                    .setRequired(true)
                    .setMinValue(1))
                .addNumberOption(opt => opt
                    .setName('stacksize')
                    .setDescription('The number of items in each stack [64]')
                    .setMinValue(1)
                    .setMaxValue(64)),
            handler: (req) => {
                const input = req.options.getNumber('count');
                const stackSize = req.options.getNumber('stacksize') || 64;
                const stacks = Math.floor(input/stackSize);
                const remainder = input%stackSize;
                req.reply(`${input.toLocaleString()} item${(input !== 1)?'s':''} equates to ${stacks.toLocaleString()} stack${(stacks !== 1)?'s':''} plus ${remainder} extra.`);
            },
        },
        stacks2items: {
            builder: new Discord.SlashCommandBuilder()
                .setName('stacks2items')
                .setDescription(`Convert stacks plus extra to a total number of items.`)
                .addNumberOption(opt => opt
                    .setName('stacks')
                    .setDescription('The number of stacks')
                    .setRequired(true)
                    .setMinValue(1))
                .addNumberOption(opt => opt
                    .setName('extra')
                    .setDescription('The number of extra items [0]')
                    .setMinValue(0)
                    .setMaxValue(64))
                .addNumberOption(opt => opt
                    .setName('stacksize')
                    .setDescription('The number of items in each stack [64]')
                    .setMinValue(1)
                    .setMaxValue(64)),
            handler: (req) => {
                const stacks = req.options.getNumber('stacks');
                const remainder = req.options.getNumber('extra') || 0;
                const stackSize = req.options.getNumber('stacksize') || 64;
                const result = (stacks*stackSize)+remainder;
                req.reply(`${stacks.toLocaleString()} stack${(stacks !== 1)?'s':''} plus ${remainder} extra equates to ${result.toLocaleString()} item${(result !== 1)?'s':''}.`);
            }
        },
        items2chests: {
            builder: new Discord.SlashCommandBuilder()
                .setName('items2chests')
                .setDescription(`See how many (double) chests you need to store a number of items.`)
                .addNumberOption(opt => opt
                    .setName('count')
                    .setDescription('The number of items')
                    .setRequired(true)
                    .setMinValue(1))
                .addBooleanOption(opt => opt
                    .setName('double')
                    .setDescription('If double chests should be used [false]'))
                .addNumberOption(opt => opt
                    .setName('stacksize')
                    .setDescription('The number of items in each stack [64]')
                    .setMinValue(1)
                    .setMaxValue(64)),
            handler: (req) => {
                const input = req.options.getNumber('count');
                const isDouble = req.options.getBoolean('double') || false;
                const chestSize = (isDouble) ? 56 : 27;
                const stackSize = req.options.getNumber('stacksize') || 64;
                const result = Math.ceil(input/stackSize/chestSize);
                req.reply(`You'll need ${result.toLocaleString()} ${(isDouble)?'double ':'single '}chest${(result !== 1)?'s':''} to store ${input.toLocaleString()} item${(input !== 1)?'s':''}.`);
            },
        },
        titlecase: {
            builder: new Discord.SlashCommandBuilder()
                .setName('titlecase')
                .setDescription(`Convert text to title case using English capitalization rules.`)
                .addStringOption(opt => opt
                    .setName('input')
                    .setDescription('Your input text')
                    .setRequired(true)),
            handler: (req) => {
                const input = req.options.getString('input');
                req.reply(titleCase(input));
            },
        },
        wikirandom: {
            builder: new Discord.SlashCommandBuilder()
                .setName('wikirandom')
                .setDescription(`Get a random Wikipedia page.`),
            handler: async(req) => {
                const res = await fetch(`https://en.wikipedia.org/w/api.php?action=query&format=json&list=random&rnnamespace=0`);
                if (res.ok) {
                    const article = (await res.json()).query.random[0];
                    req.reply(`https://en.wikipedia.org/?curid=${article.id}`);
                } else return req.reply({
                    content: 'Something went wrong!',
                    ephemeral: true
                });
            },
        },
        timestamp: {
            builder: new Discord.SlashCommandBuilder()
                .setName('timestamp')
                .setDescription(`Get the current Javascript millisecond timestamp.`),
            handler: (req) => {
                req.reply(`The current Javascript timestamp is **${Date.now()}**.`);
            },
        },
        poll: {
            builder: new Discord.SlashCommandBuilder()
                .setName('poll')
                .setDescription(`Create a poll embed and auto-react with upvote and downvote.`)
                .setDMPermission(false),
            handler: (req, opts = {}) => {
                const targetMessage = req.targetMessage;
                const modalId = getBtnId();
                req.showModal(new Discord.ModalBuilder()
                    .setCustomId(modalId)
                    .setTitle(opts.modalTitle || `Create a poll`)
                    .addComponents(
                        new Discord.ActionRowBuilder().addComponents(
                            new Discord.TextInputBuilder()
                                .setCustomId(`title`)
                                .setLabel(`Poll title`)
                                .setPlaceholder(`Should this cool thing happen?`)
                                .setStyle(Discord.TextInputStyle.Short)
                                .setMaxLength(100)
                                .setValue(opts.title || '')
                                .setRequired(true)),
                        new Discord.ActionRowBuilder().addComponents(
                            new Discord.TextInputBuilder()
                                .setCustomId(`desc`)
                                .setLabel(`Poll description`)
                                .setPlaceholder(`Here's why this cool thing should or shouldn't happen...`)
                                .setStyle(Discord.TextInputStyle.Paragraph)
                                .setMaxLength(1700)
                                .setValue(opts.desc || '')
                                .setRequired(false))
                    )
                );
                modalSubmit(modalId).then(async(submit) => {
                    const title = submit.fields.getTextInputValue('title');
                    const desc = submit.fields.getTextInputValue('desc');
                    const user = submit.user;
                    const member = submit.member;
                    const embed = new Discord.EmbedBuilder()
                        .setAuthor({
                            name: member.nickname || user.username,
                            iconURL: member.avatarURL() || user.avatarURL()
                        })
                        .setColor((targetMessage) ? targetMessage.embeds[0].color : parseInt(`0x${randomHex(6)}`))
                        .setTitle(title)
                        .setFooter({ text: `Discuss this poll in the thread below.` });
                    if (desc) embed.setDescription(desc);
                    // If edit options exist, edit the poll and thread
                    if (opts.title || opts.desc) {
                        await targetMessage.edit({
                            embeds: [embed]
                        });
                        const thread = targetMessage.channel.threads.cache.find(thread =>
                            thread.id == targetMessage.id
                        );
                        await thread.setName(title);
                        submit.reply({
                            content: `Poll edited!`,
                            ephemeral: true
                        });
                    // Otherwise, create the poll and thread
                    } else {
                        const reply = await submit.reply({
                            embeds: [embed],
                            fetchReply: true
                        });
                        await reply.react(`1026828131895623811`);
                        await reply.react(`1026828161524191242`);
                        try {
                            const thread = await reply.startThread({
                                name: title
                            });
                            thread.members.add(user.id);
                        } catch (error) {
                            submit.followUp({
                                content: `Failed to create thread.`,
                                ephemeral: true
                            });
                        }
                    }
                }).catch(() => {});
            }
        },
        editpoll: {
            builder: new Discord.SlashCommandBuilder()
                .setName('editpoll')
                .setDescription(`Edit an existing poll.`)
                .setDMPermission(false),
            handler: (req) => {
                req.reply({
                    content: `To edit an existing poll, right-click or long-press on it, navigate to the **Apps** submenu, and choose **Edit poll**.`,
                    ephemeral: true
                });
            }
        },
        'Edit poll': {
            isContextMenuCommand: true,
            builder: new Discord.ContextMenuCommandBuilder()
                .setName(`Edit poll`)
                .setType(Discord.ApplicationCommandType.Message)
                .setDMPermission(false),
            handler: (req) => {
                const msg = req.targetMessage;
                if (msg.author.id !== bot.user.id || msg.interaction.commandName !== 'poll')
                    return req.reply({
                        content: `That message isn't a poll.`,
                        ephemeral: true
                    });
                if (msg.interaction.user.id !== req.user.id) return req.reply({
                    content: `You can only edit your own polls.`,
                    ephemeral: true
                });
                commands.poll.handler(req, {
                    title: msg.embeds[0].title,
                    desc: msg.embeds[0].description,
                    modalTitle: `Edit poll`
                });
            }
        },
        ttsmp3: {
            builder: new Discord.SlashCommandBuilder()
                .setName('ttsmp3')
                .setDescription(`Get a text-to-speech MP3 file from any piece of text.`),
            handler: (req) => {
                const modalId = getBtnId();
                req.showModal(new Discord.ModalBuilder()
                    .setCustomId(modalId)
                    .setTitle(`Convert text to MP3`)
                    .addComponents(
                        new Discord.ActionRowBuilder().addComponents(
                            new Discord.TextInputBuilder()
                                .setCustomId(`input`)
                                .setLabel(`Input`)
                                .setPlaceholder(`This text will be read aloud in the resulting MP3 file...`)
                                .setStyle(Discord.TextInputStyle.Paragraph)
                                .setMaxLength(4000)
                                .setRequired(true))
                    )
                );
                modalSubmit(modalId).then(async submit => {
                    let input = submit.fields.getTextInputValue('input');
                    await submit.deferReply();
                    const fileNameBase = `${input.substring(0, 32).toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/ /g, '_')}_${randomHex(4)}`;
                    const fileName = `./${fileNameBase}.mp3`;
                    const fileNameText = `./${fileNameBase}.txt`;
                    console.log(`Saving ${input.length} chars of TTS to ${fileName}...`);
                    input = input
                        .replace(/%/g, 'percent')
                        .replace(/(\d)\.(\d)/g, '$1point$2')
                    const tts = new gtts(input, 'en');
                    tts.save(fileName, async(err, result) => {
                        if (err) {
                            await submit.editReply({
                                content: `Failed to create TTS MP3 file:\n\`\`\`${err}\`\`\``,
                                ephemeral: true
                            });
                        } else {
                            fs.writeFileSync(fileNameText, `${fileName}\n==========\n${input}`);
                            await submit.editReply({ files: [ fileName ] });
                            try {
                                fs.unlinkSync(fileName);
                                fs.unlinkSync(fileNameText);
                            } catch (error) {}
                        }
                        console.log(`TTS file sent and deleted`);
                    });
                }).catch(() => {});
            }
        },
        randomitemselector: {
            builder: new Discord.SlashCommandBuilder()
                .setName('randomitemselector')
                .setDescription(`Select a random item from a list of choices.`),
            handler: (req, opts = {}) => {
                const modalId = getBtnId();
                req.showModal(new Discord.ModalBuilder()
                    .setCustomId(modalId)
                    .setTitle(`Random Item Selector`)
                    .addComponents(
                        new Discord.ActionRowBuilder().addComponents(
                            new Discord.TextInputBuilder()
                                .setCustomId(`choices`)
                                .setLabel(`Choices`)
                                .setPlaceholder(`Put each choice on its own line...`)
                                .setStyle(Discord.TextInputStyle.Paragraph)
                                .setMaxLength(4000)
                                .setValue(opts.choices || '')
                                .setRequired(true))
                    )
                );
                modalSubmit(modalId).then(async submit => {
                    const choicesRaw = submit.fields.getTextInputValue('choices');
                    let choices = [];
                    const split = choicesRaw.split('\n');
                    for (const choice of split) {
                        if (choice.length > 256) {
                            const btn = getBtnId();
                            buttonClick(btn).then((req2) => {
                                commands.randomitemselector.handler(req2, {
                                    choices: choicesRaw
                                });
                            }).catch(() => {});
                            return submit.reply({
                                content: `Choices can't be longer than 256 characters. At least one of yours exceeds that length.`,
                                ephemeral: true,
                                components: [ new Discord.ActionRowBuilder().addComponents(...[
                                    new Discord.ButtonBuilder()
                                        .setCustomId(btn)
                                        .setLabel(`Edit choices`)
                                        .setStyle(Discord.ButtonStyle.Primary)
                                ]) ]
                            });
                        }
                        choices.push(choice);
                    }
                    choices = choices.filter(String);
                    if (choices.length < 2) {
                        const btn = getBtnId();
                        buttonClick(btn).then((req2) => {
                            commands.randomitemselector.handler(req2, {
                                choices: choicesRaw
                            });
                        }).catch(() => {});
                        return submit.reply({
                            content: `You need to provide at least two choices.`,
                            ephemeral: true,
                            components: [ new Discord.ActionRowBuilder().addComponents(...[
                                new Discord.ButtonBuilder()
                                    .setCustomId(btn)
                                    .setLabel(`Edit choices`)
                                    .setStyle(Discord.ButtonStyle.Primary)
                            ]) ]
                        });
                    }
                    let i = 0;
                    const getContent = () => {
                        const choice = choices[randomInt(0, choices.length-1)];
                        const btnAgain = getBtnId();
                        const btnEdit = getBtnId();
                        buttonClick(btnEdit).then((req2) => {
                            commands.randomitemselector.handler(req2, {
                                choices: choicesRaw
                            });
                        }).catch(() => {});
                        buttonClick(btnAgain).then((req2) => {
                            req2.deferUpdate();
                            submit.editReply(getContent());
                        }).catch(() => {});
                        i++;
                        return {
                            content: `Iteration ${i}`,
                            embeds: [new Discord.EmbedBuilder()
                                .setAuthor({ name: `Select from ${choices.length} choices` })
                                .setTitle(`${choice}`)
                                .setColor(0xdbc557)
                            ],
                            components: [ new Discord.ActionRowBuilder().addComponents(...[
                                new Discord.ButtonBuilder()
                                    .setCustomId(btnAgain)
                                    .setLabel(`Again`)
                                    .setStyle(Discord.ButtonStyle.Primary),
                                new Discord.ButtonBuilder()
                                    .setCustomId(btnEdit)
                                    .setLabel(`Edit choices...`)
                                    .setStyle(Discord.ButtonStyle.Secondary)
                            ]) ]
                        };
                    }
                    submit.reply(getContent());
                }).catch(() => {});
            }
        },
        define: {
            builder: new Discord.SlashCommandBuilder()
                .setName('define')
                .setDescription(`Get definitions for and examples of a word.`)
                .addStringOption(opt => opt
                    .setName('word')
                    .setDescription('The target word')
                    .setRequired(true)
                    .setAutocomplete(true)),
            handler: async(req) => {
                const input = req.options.getString('word').trim();
                const db = sqlite3('./dictionary.db');
                const entries = db.prepare(`SELECT * FROM meanings WHERE word = ?`).all(input);
                if (entries.length == 0) return req.reply({
                    content: `We don't have a definition for that word!`,
                    ephemeral: true
                });
                const byPartOfSpeech = {};
                entries.forEach(meaning => {
                    if (!byPartOfSpeech[meaning.part_of_speech])
                        byPartOfSpeech[meaning.part_of_speech] = [];
                    byPartOfSpeech[meaning.part_of_speech].push(meaning);
                })
                db.close();
                const embeds = [];
                Object.keys(byPartOfSpeech).forEach(partOfSpeech => {
                    const embed = new Discord.EmbedBuilder();
                    embed.setColor(0xd7dff5);
                    embed.setAuthor({ name: partOfSpeech });
                    embed.setTitle(byPartOfSpeech[partOfSpeech][0].word);
                    let desc = '';
                    byPartOfSpeech[partOfSpeech].forEach((meaning, i) => {
                        desc += `${i+1}. **${meaning.definition}**${(meaning.example ? `\n> ${meaning.example}`:'')}\n\n`;
                    });
                    embed.setDescription(desc);
                    embeds.push(embed);
                });
                req.reply({ embeds: embeds });
            },
            autocompleter: req => {
                const value = req.options.getFocused().trim().toLowerCase();
                if (!value) return req.respond([]);
                const filter = new Fuse(wordList);
                let resultsAll = filter.search(value);
                let results = [];
                resultsAll.forEach((result) => {
                    if (results.length > 4) return;
                    results.push({ name: result.item, value: result.item });
                });
                req.respond(results);
            }
        },
        urbandefine: {
            builder: new Discord.SlashCommandBuilder()
                .setName('urbandefine')
                .setDescription(`Get Urban Dictionary entries for a word or phrase.`)
                .addStringOption(opt => opt
                    .setName('word')
                    .setDescription('The target word or phrase')
                    .setRequired(true)),
            handler: async(req, opts = { path: [] }) => {
                const input = opts.match || req.options.getString('word').trim();
                opts.path.push(input);
                const path = `"${opts.path.join('" \> "')}"`;
                if (!opts.match) await req.deferReply();
                const res = await (await fetch(`https://mashape-community-urban-dictionary.p.rapidapi.com/define?term=${input}`, {
                    headers: {
                        'X-RapidAPI-Key': config.rapidapi_key,
                        'X-RapidAPI-Host': `mashape-community-urban-dictionary.p.rapidapi.com`
                    }
                })).json();
                if (!res.list.length) return req.editReply({
                    content: `${path}\nThe search for this word's definition came up empty (or failed).`
                });
                res.list.sort((a, b) => {
                    const score = {
                        a: a.thumbs_up-a.thumbs_down,
                        b: b.thumbs_up-b.thumbs_down
                    };
                    return score.b-score.a;
                });
                const embeds = [];
                const search = [];
                let i = 0;
                for (const entry of res.list) {
                    const embed = new Discord.EmbedBuilder();
                    embed.setColor(0x0f3fb8);
                    embed.setAuthor({
                        name: `Defined by ${entry.author} on ${dayjs(entry.written_on).format('MMM D, YYYY')}`,
                        url: `https://www.urbandictionary.com/author.php?author=${encodeURIComponent(entry.author)}`
                    });
                    embed.setTitle(entry.word);
                    embed.setURL(`https://www.urbandictionary.com/define.php?term=${encodeURIComponent(entry.word)}`);
                    const exampleLines = entry.example.split('\n');
                    let example = '';
                    exampleLines.forEach(line => example += `> ${line.trim()}\n`);
                    let desc = `**${entry.definition}**\n\n${example}`;
                    const matches = desc.match(/\[(.+?)\]/g) || [];
                    let matchesDone = [];
                    matches.forEach(match => {
                        if (matchesDone.includes(match)) return;
                        desc = desc.replace(match, `${match}(https://www.urbandictionary.com/define.php?term=${encodeURIComponent(match.replace(/(\[|\])/g, ''))})`);
                        matchesDone.push(match);
                    });
                    search.push(matchesDone);
                    if (desc.length > 4000) {
                        const words = desc.split(' ');
                        desc = '';
                        while (desc.length < 4000) desc += words.shift();
                        desc += '...';
                    }
                    desc.replace(/</g, '\\<');
                    desc.replace(/\r/g, '');
                    desc.replace(/\r\n/g, '\n');
                    embed.setDescription(desc);
                    embed.setFooter({ text: `Definition ${i+1} of ${res.list.length}` });
                    embeds.push(embed);
                    i++;
                }
                let cursor = 0;
                const update = async() => {
                    const rows = [];
                    let buttons = [];
                    for (let match of search[cursor]) {
                        if (rows.length > 4) return;
                        match = match.replace(/(\[|\])/g, '');
                        if (match.toLowerCase() == input.toLowerCase()) break;
                        const id = getBtnId();
                        buttons.push(new Discord.ButtonBuilder()
                            .setCustomId(id)
                            .setLabel(match)
                            .setEmoji('🔎')
                            .setStyle(Discord.ButtonStyle.Secondary));
                        buttonClick(id).then((req2) => {
                            req2.deferUpdate();
                            opts.match = match;
                            commands.urbandefine.handler(req, opts);
                        }).catch(() => {});
                        if (buttons.length == 5) {
                            rows.push(new Discord.ActionRowBuilder().addComponents(...buttons));
                            buttons = [];
                        }
                    }
                    if (buttons.length)
                        rows.push(new Discord.ActionRowBuilder().addComponents(...buttons));
                    const actions = new Discord.ActionRowBuilder();
                    const btnPrevId = getBtnId();
                    const btnPrev = new Discord.ButtonBuilder()
                        .setCustomId(btnPrevId)
                        .setLabel(`Previous`)
                        .setStyle(Discord.ButtonStyle.Primary);
                    buttonClick(btnPrevId).then(async(req2) => {
                        await req2.deferUpdate();
                        cursor--;
                        if (cursor < 0) cursor = 0;
                        update();
                    }).catch(() => {});
                    const btnNextId = getBtnId();
                    const btnNext = new Discord.ButtonBuilder()
                        .setCustomId(btnNextId)
                        .setLabel(`Next`)
                        .setStyle(Discord.ButtonStyle.Primary);
                    buttonClick(btnNextId).then(async(req2) => {
                        await req2.deferUpdate();
                        cursor++;
                        if (cursor > embeds.length-1) cursor = embeds.length-1;
                        update();
                    }).catch(() => {});
                    if (cursor === 0)
                        btnPrev.setDisabled(true).setStyle(Discord.ButtonStyle.Secondary);
                    if (cursor === embeds.length-1)
                        btnNext.setDisabled(true).setStyle(Discord.ButtonStyle.Secondary);
                    actions.addComponents(btnPrev, btnNext);
                    rows.push(actions);
                    try {
                        await req.editReply({
                            content: path,
                            embeds: [ embeds[cursor] ],
                            components: rows
                        });
                    } catch (error) {
                        await req.followUp({
                            content: `An error occurred while editing the message!`,
                            ephemeral: true
                        });
                    }
                }
                update();
            }
        },
        convert: {
            builder: (() => {
                const builder = new Discord.SlashCommandBuilder()
                    .setName('convert')
                    .setDescription(`Convert between units of measurement.`);
                Object.keys(conversions).forEach((key) => {
                    const unit = conversions[key];
                    const unitIds = Object.keys(unit.units);
                    let choices = [];
                    unitIds.forEach((id) => {
                        choices.push({
                            name: unit.units[id].name, value: id
                        });
                    });
                    if (choices.length < 2) return;
                    builder.addSubcommand(cmd => cmd
                        .setName(key)
                        .setDescription(`Convert between units of ${unit.name.toLowerCase()}.`)
                        .addNumberOption(opt => opt
                            .setName('value')
                            .setDescription('The value you want to convert')
                            .setMinValue(-Number.MAX_SAFE_INTEGER)
                            .setMaxValue(Number.MAX_SAFE_INTEGER)
                            .setRequired(true))
                        .addStringOption(opt => {
                            opt.setName('from')
                            .setDescription(`The source unit`)
                            .setRequired(true);
                            if (choices.length < 25)
                                opt.setChoices(...choices);
                            else
                                opt.setAutocomplete(true);
                            return opt;
                        })
                        .addStringOption(opt => {
                            opt.setName('to')
                            .setDescription(`The target unit`)
                            .setRequired(true);
                            if (choices.length < 25)
                                opt.setChoices(...choices);
                            else
                                opt.setAutocomplete(true);
                            return opt;
                        }));
                });
                return builder;
            })(),
            handler: (req) => {
                const category = req.options.getSubcommand();
                const units = conversions[category].units;
                const valueA = req.options.getNumber('value');
                const unitA = conversions[category].units[req.options.getString('from')];
                const unitB = conversions[category].units[req.options.getString('to')];
                if (!unitA || !unitB) return req.reply({
                    content: `Invalid unit! Make sure you're selecting one of the autocomplete options.`,
                    ephemeral: true
                });
                const unitIdsByLength = Object.keys(units).sort((a, b) => {
                    return (a.length-b.length);
                }).reverse();
                const parseExp = (exp) => {
                    while (true) {
                        let changed = false;
                        unitIdsByLength.forEach((key) => {
                            if (exp.match(new RegExp(key))) {
                                exp = exp.replace(key, units[key].toBase);
                                changed = true;
                            }
                        });
                        if (!changed) break;
                    }
                    return exp;
                };
                const _rel = (a, unitA, unitB) => {
                    const baseEq = parseExp(unitA.toBase);
                    const valueEq = unitB.fromBase || `y/(${parseExp(unitB.toBase)})`;
                    let base = parseFloat(mathjs.evaluate(baseEq, {
                        x: parseFloat(a)
                    }));
                    let value = 0;
                    if (unitB.fromBase)
                        value = roundSmart(parseFloat(mathjs.evaluate(valueEq, {
                            x: base
                        })).toLocaleString('fullwide', { useGrouping: false }), 5);
                    else
                        value = roundSmart(parseFloat(mathjs.evaluate(valueEq, {
                            x: 1, y: base
                        })).toLocaleString('fullwide', { useGrouping: false }), 5);
                    return value;
                };
                const result = _rel(valueA, unitA, unitB);
                req.reply({
                    embeds: [
                        new Discord.EmbedBuilder()
                            .setColor(0x576ddb)
                            .setTitle(`Convert ${conversions[category].name}`)
                            .addFields(
                                { name: valueA.toLocaleString(), value: (unitA.saveCase) ? unitA.name : titleCase(unitA.name), inline: true },
                                { name: result.toLocaleString(), value: (unitB.saveCase) ? unitB.name : titleCase(unitB.name), inline: true }
                            )
                    ]
                });
            },
            autocompleter: (req) => {
                const category = req.options.getSubcommand();
                const value = req.options.getFocused();
                let choices = [];
                Object.keys(conversions[category].units).forEach((key) => {
                    const unit = conversions[category].units[key];
                    choices.push({ name: unit.name, value: key });
                });
                const filter = new Fuse(choices, { keys: [ 'name' ] });
                let resultsAll = filter.search(value);
                let results = [];
                resultsAll.forEach((result) => {
                    if (results.length > 24) return;
                    results.push(result.item);
                });
                req.respond(results);
            }
        },
        dice: {
            builder: new Discord.SlashCommandBuilder()
                .setName('dice')
                .setDescription(`Roll a custom set of dice provided comma-separated dice notation.`)
                .addStringOption(opt => opt
                    .setName('notation')
                    .setDescription(`Dice notation - for example, "2d6,d20" will roll two 6-sided dice and one 20-sided die`)
                    .setRequired(true)),
            handler: async req => {
                await req.deferReply();
                const notation = req.options.getString('notation');
                let isValid = true;
                const split = notation.split(',').filter(String);
                let rollCount = 0;
                const update = () => {
                    let total = 0;
                    split.forEach(piece => {
                        if (!isValid) return;
                        piece = piece.trim();
                        const matches = piece.match(/^(|\d+)d(\d+)($|\+(\d+)$)/);
                        if (!matches) {
                            isValid = false;
                            return req.followUp({
                                content: `\`${piece}\` isn't valid dice notation. Make sure you're following the format outlined [here](https://en.wikipedia.org/wiki/Dice_notation).`,
                                ephemeral: true
                            });
                        }
                        const count = parseInt(matches[1]) || 1;
                        const sides = parseInt(matches[2]);
                        const add = parseInt(matches[4]) || 0;
                        if (count < 1) {
                            isValid = false;
                            return req.followUp({
                                content: `You can't roll negative amounts of dice!`,
                                ephemeral: true
                            });
                        }
                        if (sides < 2) {
                            isValid = false;
                            return req.followUp({
                                content: `Each die must have at least 2 sides.`,
                                ephemeral: true
                            });
                        }
                        for (let i = 0; i < count; i++) {
                            total += randomInt(1, sides);
                        }
                        total += add;
                    });
                    rollCount++;
                    if (isValid) {
                        const btnId = getBtnId();
                        buttonClick(btnId).then(click => {
                            click.deferUpdate();
                            update();
                        }).catch(() => {});
                        req.editReply({
                            content: `Roll ${rollCount}`,
                            embeds: [
                                new Discord.EmbedBuilder()
                                    .setTitle('Dice')
                                    .setColor(0xdbc557)
                                    .addFields(
                                        { name: split.join(', '), value: `= ${total}` }
                                    )
                            ],
                            components: [new Discord.ActionRowBuilder().addComponents(
                                new Discord.ButtonBuilder()
                                    .setCustomId(btnId)
                                    .setLabel(`Roll again`)
                                    .setStyle(Discord.ButtonStyle.Primary)
                            )]
                        });
                    }
                };
                update();
            }
        },
        isportopen: {
            builder: new Discord.SlashCommandBuilder()
                .setName(`isportopen`)
                .setDescription(`Check if a port is open on a provided hostname or IP address.`)
                .addStringOption(opt => opt
                    .setName(`host`)
                    .setDescription(`The target hostname or IP address`)
                    .setRequired(true))
                .addNumberOption(opt => opt
                    .setName(`port`)
                    .setDescription(`The target port`)
                    .setMinValue(1)
                    .setMaxValue(65535)
                    .setRequired(true)),
            handler: async req => {
                await req.deferReply();
                const host = req.options.getString('host');
                const port = req.options.getNumber('port');
                if (!isValidIp(host) && !isValidHostname(host)) return req.followUp({
                    content: `\`${host}\` isn't a valid hostname or IP address.`,
                    ephemeral: true
                });
                const isPortReachable = await (await import('is-port-reachable')).default;
                const isOpen = await isPortReachable(port, { host: host });
                return req.editReply({
                    embeds: [
                        new Discord.EmbedBuilder()
                            .setColor(isOpen ? 0x57db6d : 0xdb5757)
                            .setTitle(`Open Port Checker`)
                            .addFields(
                                { name: `Host`, value: host, inline: true },
                                { name: `Port`, value: port.toString(), inline: true },
                                { name: `Status`, value: (isOpen) ? ':green_circle: Open' : ':red_circle: Closed' }
                            )
                    ]
                });
            }
        },
        locateip: {
            builder: new Discord.SlashCommandBuilder()
                .setName(`locateip`)
                .setDescription(`Get the location of an IP address or hostname.`)
                .addStringOption(opt => opt
                    .setName(`host`)
                    .setDescription(`The target IP address or hostname`)
                    .setRequired(true)),
            handler: async req => {
                await req.deferReply();
                const host = req.options.getString('host');
                if (!isValidIp(host) && !isValidHostname(host)) return req.followUp({
                    content: `\`${host}\` isn't a valid IP or hostname.`,
                    ephemeral: true
                });
                const data = await (await fetch(`http://ip-api.com/json/${host}?fields=17023993`)).json();
                if (data.status !== 'success') return req.followUp({
                    content: `Failed to fetch location data for this host.`,
                    ephemeral: true
                });
                const emoji = { yes: ':green_circle: Yes', no: ':red_circle: No' };
                req.editReply({
                    embeds: [
                        new Discord.EmbedBuilder()
                            .setAuthor({ name: `IP Locator` })
                            .setColor(0x576ddb) // hsl(230, 65%, 60%)
                            .setTitle(`${host}`)
                            .setFields(
                                { name: 'Country', value: data.country, inline: true },
                                { name: 'State/region', value: data.regionName, inline: true },
                                { name: 'City', value: data.city, inline: true },
                                { name: 'Postal code', value: data.zip, inline: true },
                                { name: 'Coordinates', value: `${data.lat}, ${data.lon}`, 
                                  inline: true },
                                { name: 'ISP', value: data.isp, inline: true },
                                { name: 'Timezone', value: data.timezone }
                            )
                    ]
                });
            }
        },
        shortlink: {
            builder: new Discord.SlashCommandBuilder()
                .setName(`shortlink`)
                .setDescription(`Shorten a link on the ${config.shortener_domain} domain.`)
                .addSubcommand(cmd => cmd
                    .setName('shorten')
                    .setDescription(`Create a new ${config.shortener_domain} short link.`)
                    .addStringOption(opt => opt
                        .setName(`url`)
                        .setDescription(`The link to shorten`)
                        .setRequired(true))
                    .addStringOption(opt => opt
                        .setName(`slug`)
                        .setDescription(`A custom short link ending - leave empty for a random ending`)))
                .addSubcommand(cmd => cmd
                    .setName('stats')
                    .setDescription(`Get stats about a short link.`)
                    .addStringOption(opt => opt
                        .setName(`slug`)
                        .setDescription(`The short link (or just its ending)`)
                        .setRequired(true)))
                .addSubcommand(cmd => cmd
                    .setName('disable')
                    .setDescription(`Disable one of your short links, preventing visitors from accessing it.`)
                    .addStringOption(opt => opt
                        .setName(`slug`)
                        .setDescription(`The short link (or just its ending)`)
                        .setRequired(true)))
                .addSubcommand(cmd => cmd
                    .setName('enable')
                    .setDescription(`Re-enable one of your disabled short links.`)
                    .addStringOption(opt => opt
                        .setName(`slug`)
                        .setDescription(`The short link (or just its ending)`)
                        .setRequired(true)))
                .addSubcommand(cmd => cmd
                    .setName('me')
                    .setDescription(`Get info about your short links.`)),
            handler: async req => {
                const subcmd = req.options.getSubcommand();
                await req.deferReply({ ephemeral: true });
                const db = sqlite3('./shortener.db');
                // If this is the stats subcommand
                if (subcmd == 'stats') {
                    const slug = req.options.getString('slug').split('/').reverse()[0];
                    const entry = db.prepare(`SELECT * FROM links WHERE slug = ?`).get(slug);
                    const count = {
                        total: db.prepare(`SELECT count(slug) FROM links`).get()[`count(slug)`],
                        user: db.prepare(`SELECT count(slug) FROM links WHERE user = ?`).get(req.user.id)[`count(slug)`]
                    };
                    db.close();
                    if (!entry) return req.editReply({
                        content: `That short link (or ending) doesn't exist!`,
                        ephemeral: true
                    });
                    if (!entry.title) entry.title = entry.url;
                    return req.editReply({
                        embeds: [
                            new Discord.EmbedBuilder()
                                .setColor(0x57db6d)
                                .setAuthor({ name: `Short link stats` })
                                .setTitle(entry.title.substring(0, 255))
                                .setURL(`https://${config.shortener_domain}/${entry.slug}`)
                                .addFields(
                                    { name: `Short link`, value: `https://${config.shortener_domain}/${entry.slug}` },
                                    { name: `Created`, value: `<t:${Math.round(entry.created/1000)}:R>`, inline: true },
                                    { name: `Clicks`, value: `${entry.count_clicks}`, inline: true },
                                    { name: `Destination`, value: `${entry.url}` }
                                )
                                .setFooter({ text: `${count.total} total short links, ${count.user} by you` })
                        ],
                        ephemeral: true
                    });
                }
                // If this is the shorten subcommand
                if (subcmd == 'shorten') {
                    const url = req.options.getString('url');
                    const slug = req.options.getString('slug') || randomHex(6);
                    // Make sure URL is valid
                    if (!isValidUrl(url)) {
                        db.close();
                        return req.editReply({
                            content: `That URL is invalid!`,
                            ephemeral: true
                        });
                    }
                    // Make sure URL isn't too long
                    if (url.length > 2000) {
                        db.close();
                        return req.editReply({
                            content: `That URL is too long!`,
                            ephemeral: true
                        });
                    }
                    // Make sure slug is valid
                    if (slug.length < 3 || slug.length > 64 || slug.match(/[^a-zA-Z0-9-_]/g)) {
                        db.close();
                        return req.editReply({
                            content: `That short link ending is invalid! Make sure it's between 3 and 64 characters long, and only contains alphanumeric characters, hyphens, and underscores.`,
                            ephemeral: true
                        });
                    }
                    // Make sure slug isn't already taken
                    if (db.prepare(`SELECT slug FROM links WHERE slug = ?`).get(slug)) {
                        db.close();
                        return req.editReply({
                            content: `That short link ending is already taken!`,
                            ephemeral: true
                        });
                    }
                    // Make sure provided URL isn't matched by Safe Browsing
                    const res = await fetch(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${config.safe_browsing_key}`, {
                        method: 'post',
                        body: JSON.stringify({
                            client: {
                                clientId: 'simplecybernetwork',
                                clientVersion: '1.0'
                            },
                            threatInfo: {
                                threatTypes: [ 'MALWARE', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION', 'SOCIAL_ENGINEERING' ],
                                platformTypes: [ 'ANY_PLATFORM' ],
                                threatEntryTypes: [ 'URL' ],
                                threatEntries: [ { url: url } ]
                            }
                        })
                    });
                    const json = await res.json();
                    if (json.matches) {
                        db.close();
                        return req.editReply({
                            content: `That link can't be shortened because [Google Safe Browsing](<https://safebrowsing.google.com/>) detects it as unsafe.`,
                            ephemeral: true
                        });
                    }
                    // Get URL headers
                    let title = null;
                    const head = await fetch(url, { method: 'head' });
                    // If the content type is HTML, get the page title
                    const type = head.headers.get('content-type') || '';
                    if (type.split(';')[0] == 'text/html') {
                        const document = parseHtml.parse(await (await fetch(url)).text());
                        title = document.getElementsByTagName('title')[0].innerText || null;
                    }
                    // Add new link to database
                    db.prepare(`INSERT INTO links (created, user, url, title, slug) VALUES (?, ?, ?, ?, ?)`).run(Date.now(), req.user.id, url, title, slug);
                    db.close();
                    // Finish
                    console.log(`New short link created with slug: ${slug}`);
                    return req.editReply({
                        content: `Your link has been shortened to <https://${config.shortener_domain}/${slug}>! Right-click or long-press on it to copy.`,
                        ephemeral: true
                    });
                }
                // If this is the disable/enable subcommand
                if (subcmd == 'disable' || subcmd == 'enable') {
                    const shouldDisable = (subcmd == 'disable') ? 1 : 0;
                    const slug = req.options.getString('slug').split('/').reverse()[0];
                    const entry = db.prepare(`SELECT * FROM links WHERE slug = ?`).get(slug);
                    if (!entry) {
                        db.close();
                        return req.editReply({
                            content: `That short link doesn't exist!`,
                            ephemeral: true
                        });
                    }
                    if (entry.user !== req.user.id) {
                        db.close();
                        return req.editReply({
                            content: `That short link doesn't belong to you!`,
                            ephemeral: true
                        });
                    }
                    if (entry.disabled === shouldDisable) {
                        db.close();
                        return req.editReply({
                            content: `That short link is already ${shouldDisable ? 'disabled':'enabled'}!`,
                            ephemeral: true
                        });
                    }
                    db.prepare(`UPDATE links SET disabled = ? WHERE slug = ?`).run(shouldDisable, slug);
                    const msg = (shouldDisable)
                        ? `Your short link \`${slug}\` is now disabled. Visitors of this link won't be redirected, but will instead see a notice explaining that the link has been disabled by its creator.\nYou can re-enable this short link at any time with **/shortlink enable**.`
                        : `Your short link \`${slug}\` has been re-enabled.`;
                    return req.editReply({
                        content: msg,
                        ephemeral: true
                    });
                }
                // If this is the me subcommand
                if (subcmd == 'me') {
                    const total = db.prepare(`SELECT count(slug) FROM links WHERE user = ?`).get(req.user.id)[`count(slug)`];
                    db.close();
                    const perPage = 8;
                    let cursor = 0;
                    const update = () => {
                        const db = sqlite3('./shortener.db');
                        const entries = db.prepare(`SELECT * FROM links WHERE user = ? ORDER BY created DESC LIMIT ?,?`).all(req.user.id, cursor, perPage).reverse();
                        db.close();
                        const embeds = [];
                        entries.forEach(entry => {
                            if (!entry.title) entry.title = entry.url;
                            embeds.push(
                                new Discord.EmbedBuilder()
                                    .setColor(0x57db6d)
                                    .setTitle(entry.title.substring(0, 255))
                                    .setURL(`https://${config.shortener_domain}/${entry.slug}`)
                                    .addFields(
                                        { name: `Short link`, value: `https://${config.shortener_domain}/${entry.slug}` },
                                        { name: `Created`, value: `<t:${Math.round(entry.created/1000)}:R>`, inline: true },
                                        { name: `Clicks`, value: `${entry.count_clicks}`, inline: true },
                                        { name: `Destination`, value: `${entry.url}` },
                                        { name: `Status`, value: `${entry.disabled ? ':red_circle: Disabled':':green_circle: Enabled'}` }
                                    )
                            );
                        });
                        const prev = getBtnId();
                        const next = getBtnId();
                        buttonClick(prev).then(req2 => {
                            req2.deferUpdate();
                            cursor = overflow(cursor-perPage, 0, total-1);
                            update();
                        }).catch(() => {});
                        buttonClick(next).then(req2 => {
                            req2.deferUpdate();
                            cursor = overflow(cursor+perPage, 0, total-1);
                            update();
                        }).catch(() => {});
                        req.editReply({
                            content: `Showing links ${cursor+1} to ${Math.min(cursor+perPage, total)} of ${total}`,
                            embeds: embeds,
                            components: [
                                new Discord.ActionRowBuilder().addComponents(
                                    new Discord.ButtonBuilder()
                                        .setCustomId(prev)
                                        .setEmoji('◀️')
                                        .setStyle(Discord.ButtonStyle.Secondary),
                                    new Discord.ButtonBuilder()
                                        .setCustomId(next)
                                        .setEmoji('▶️')
                                        .setStyle(Discord.ButtonStyle.Secondary)
                                )
                            ],
                            ephemeral: true
                        });
                    };
                    update();
                }
            }
        },
        translate: {
            builder: new Discord.SlashCommandBuilder()
                .setName(`translate`)
                .setDescription(`Translate text with Google Translate.`)
                .addStringOption(opt => opt
                    .setName(`to`)
                    .setDescription(`The target language`)
                    .setAutocomplete(true)
                    .setRequired(true)),
            handler: req => {
                const target = req.options.getString('to');
                const lang = (() => {
                    for (const lang of languages) {
                        if (lang.code == target) return lang;
                    }
                })();
                const modalId = getBtnId();
                req.showModal(new Discord.ModalBuilder()
                    .setCustomId(modalId)
                    .setTitle(`Translate to ${lang.name}`)
                    .addComponents(
                        new Discord.ActionRowBuilder().addComponents(
                            new Discord.TextInputBuilder()
                                .setCustomId(`input`)
                                .setLabel(`Input`)
                                .setPlaceholder(`The language of this input will be auto-detected.`)
                                .setStyle(Discord.TextInputStyle.Paragraph)
                                .setMaxLength(500)
                                .setRequired(true))
                    )
                );
                modalSubmit(modalId).then(async req2 => {
                    const input = req2.fields.getTextInputValue('input');
                    const link = `https://translate.google.com/?sl=auto&tl=${target}&text=${encodeURI(input)}&op=translate`;
                    await req2.deferReply();
                    const res = await (await fetch(`https://translation.googleapis.com/language/translate/v2?key=${config.gcloud_key}`, {
                        method: 'post',
                        body: JSON.stringify({
                            q: input,
                            target: target
                        })
                    })).json();
                    if (res.error || !res.data || !res.data.translations[0]) return req2.editReply(`Something went wrong during translation. Try [viewing your input directly on Google Translate](<${link}>).`);
                    const translation = res.data.translations[0];
                    const langSource = (() => {
                        for (const lang of languages) {
                            if (lang.code == translation.detectedSourceLanguage)
                                return lang;
                        }
                    })();
                    req2.editReply({
                        embeds: [
                            new Discord.EmbedBuilder()
                                .setColor(0x1a73e8)
                                .setTitle(`Translation`)
                                .setDescription(`[View in Google Translate](${link})`)
                                .addFields(
                                    {
                                        name: langSource.name.split('/')[0].replace(sanitizeRegex, '\\$1'),
                                        value: input
                                    }, {
                                        name: lang.name.split('/')[0],
                                        value: translation.translatedText.replace(sanitizeRegex, '\\$1')
                                    }
                                )
                        ]
                    })
                }).catch(() => {});
            },
            autocompleter: req => {
                const value = req.options.getFocused();
                const filter = new Fuse(languages, { keys: [ 'code', 'name', 'native' ] });
                const resultsAll = filter.search(value);
                const results = [];
                resultsAll.forEach((result) => {
                    result = result.item;
                    if (results.length > 24) return;
                    results.push({
                        name: `${result.name.split('/')[0]} (${result.native.split('/')[0]})`,
                        value: result.code
                    });
                });
                req.respond(results);
            }
        },
        screenshot: {
            builder: new Discord.SlashCommandBuilder()
                .setName(`screenshot`)
                .setDescription(`Capture a screenshot of a website.`)
                .addStringOption(opt => opt
                    .setName(`url`)
                    .setDescription(`The target URL`)
                    .setRequired(true))
                .addNumberOption(opt => opt
                    .setName(`width`)
                    .setDescription(`The browser window's width [1280]`)
                    .setMinValue(32)
                    .setMaxValue(2048))
                .addNumberOption(opt => opt
                    .setName(`height`)
                    .setDescription(`The browser window's height [720]`)
                    .setMinValue(32)
                    .setMaxValue(2048)),
            handler: async req => {
                await req.deferReply();
                const url = req.options.getString('url');
                const width = req.options.getNumber('width') || 1280;
                const height = req.options.getNumber('height') || 720;
                if (!isValidUrl(url)) {
                    return req.editReply({
                        content: `That URL is invalid!`,
                        ephemeral: true
                    });
                }
                if (isUserScreenshotting[req.user.id]) {
                    return req.editReply({
                        content: `Wait for your previous screenshot to finish first.`,
                        ephemeral: true
                    });
                }
                const urlParsed = new URL(url);
                isUserScreenshotting[req.user.id] = true;
                console.log(`Starting puppeteer for website screenshot...`);
                const browser = await puppeteer.launch();
                const page = await browser.newPage();
                await page.setViewport({ width: width, height: height });
                try {
                    console.log(`Navigating to ${url}...`);
                    await page.goto(url);
                    await page.waitForNetworkIdle({ timeout: 10000 });
                } catch (error) {
                    isUserScreenshotting[req.user.id] = false;
                    return req.editReply({
                        content: `\`\`\`${error}\`\`\``,
                        ephemeral: true
                    });
                }
                console.log(`Capturing screenshot...`);
                const imageName = `${urlParsed.host}_${Date.now()}.png`;
                await page.screenshot({
                    path: imageName,
                    type: 'png',
                    omitBackground: true
                });
                await page.close();
                await browser.close();
                isUserScreenshotting[req.user.id] = false;
                if (fs.statSync(imageName).size > (1000*1000*8)) {
                    if (!fs.existsSync(`./web/content/`)) fs.mkdirSync(`./web/content/`);
                    fs.renameSync(imageName, `./web/content/${imageName}`);
                    await req.editReply(`This screenshot is larger than 8 MB, so you'll have to access it through this link instead:\nhttps://${config.web_domain}/content/${imageName}\nImages won't stay on this site forever, so consider saving it if you want to keep it.`);
                } else {
                    await req.editReply({
                        files: [imageName]
                    });
                    fs.unlinkSync(imageName);
                }
            }
        },
        youtubedl: {
            builder: new Discord.SlashCommandBuilder()
                .setName(`youtubedl`)
                .setDescription(`Download video and audio files from YouTube.`)
                .addStringOption(opt => opt
                    .setName(`url`)
                    .setDescription(`The YouTube video's URL`)
                    .setRequired(true)),
            handler: async req => {
                await req.deferReply();
                const url = req.options.getString('url');
                if (!isValidUrl(url)) {
                    return req.editReply({
                        content: `That video URL is invalid!`,
                        ephemeral: true
                    });
                }
                const info = await ytdl.getInfo(url);
                if (!info.videoDetails) return req.editReply({
                    content: `That video is unavailable.`,
                    ephemeral: true
                });
                const formats = [
                    ...ytdl.filterFormats(info.formats, 'videoandaudio'),
                    ...ytdl.filterFormats(info.formats, 'audioonly')
                ];
                const selectId = getBtnId();
                const getAudioExt = ext => {
                    if (ext == 'mp4') return 'M4A';
                    if (ext == 'webm') return 'WEBA';
                }
                const getFormatLabel = format => {
                    if (format.hasVideo)
                        return `${format.height}p${format.fps} ${format.container.toUpperCase()} video with ${format.audioBitrate}Kbps audio`;
                    if (!format.hasVideo && format.hasAudio)
                        return `${format.audioBitrate}Kbps ${getAudioExt(format.container)} audio`
                }
                selectMenuSelect(selectId).then(req2 => {
                    const value = req2.values[0];
                    const format = formats[parseInt(value)];
                    const id = Date.now();
                    ytdlUrls[id] = `${format.url}&title=${info.videoDetails.title.replace(/[^a-zA-Z0-9-_ ]/g, '')}`;
                    req2.update({
                        content: `**${info.videoDetails.title}** by **${info.videoDetails.author.name}**\n${getFormatLabel(format)}`,
                        components: [new Discord.ActionRowBuilder().addComponents(
                            new Discord.ButtonBuilder()
                                .setLabel(`Download...`)
                                .setURL(`https://${config.web_domain}/ytdl/${id}`)
                                .setStyle(Discord.ButtonStyle.Link)
                        )]
                    })
                }).catch(() => {});
                req.editReply({
                    content: `Found **${info.videoDetails.title}** by **${info.videoDetails.author.name}**`,
                    components: [new Discord.ActionRowBuilder().addComponents(
                        new Discord.SelectMenuBuilder()
                            .setCustomId(selectId)
                            .setPlaceholder(`Download format...`)
                            .addOptions(...(() => {
                                const opts = [];
                                formats.forEach((format, i) => {
                                    opts.push({
                                        label: getFormatLabel(format),
                                        value: i.toString()
                                    });
                                });
                                return opts;
                            })())
                    )]
                });
            }
        },
        request: {
            builder: new Discord.SlashCommandBuilder()
                .setName('request')
                .setDescription(`Request a new slash command.`),
            handler: (req) => {
                const modalId = getBtnId();
                req.showModal(new Discord.ModalBuilder()
                    .setCustomId(modalId)
                    .setTitle(`Command request`)
                    .addComponents(
                        new Discord.ActionRowBuilder().addComponents(
                            new Discord.TextInputBuilder()
                                .setCustomId(`input`)
                                .setLabel(`Request`)
                                .setPlaceholder(`Describe your command idea in as much detail as possible.`)
                                .setStyle(Discord.TextInputStyle.Paragraph)
                                .setMaxLength(1000)
                                .setRequired(true))
                    )
                );
                modalSubmit(modalId).then(async req2 => {
                    await req2.deferReply({ ephemeral: true });
                    const input = req2.fields.getTextInputValue('input');
                    const owner = bot.users.cache.get(config.owner_id);
                    await owner.send({
                        embeds: [
                            new Discord.EmbedBuilder()
                                .setColor(0x1a73e8)
                                .setAuthor({ name: `${req.user.username}#${req.user.discriminator}`, iconURL: req.user.avatarURL() })
                                .setTitle(`Request`)
                                .setDescription(input || '')
                        ]
                    });
                    req2.editReply({
                        content: `Your request has been sent. Thanks!`,
                        ephemeral: true
                    });
                }).catch(() => {});
            }
        },
        base64: {
            builder: new Discord.SlashCommandBuilder()
                .setName('base64')
                .setDescription(`Convert between text and base64.`)
                .addSubcommand(cmd => cmd
                    .setName('encode')
                    .setDescription(`Encode text as base64`))
                .addSubcommand(cmd => cmd
                    .setName('decode')
                    .setDescription(`Decode base64 into text`)),
            handler: (req) => {
                const subcmd = req.options.getSubcommand();
                const modalId = getBtnId();
                if (subcmd == 'encode') {
                    req.showModal(new Discord.ModalBuilder()
                        .setCustomId(modalId)
                        .setTitle(`Text to Base64`)
                        .addComponents(
                            new Discord.ActionRowBuilder().addComponents(
                                new Discord.TextInputBuilder()
                                    .setCustomId(`input`)
                                    .setLabel(`Text input`)
                                    .setPlaceholder(`This text will be encoded as base64...`)
                                    .setStyle(Discord.TextInputStyle.Paragraph)
                                    .setMaxLength(900)
                                    .setRequired(true))
                        )
                    );
                } else {
                    req.showModal(new Discord.ModalBuilder()
                        .setCustomId(modalId)
                        .setTitle(`Base64 to Text`)
                        .addComponents(
                            new Discord.ActionRowBuilder().addComponents(
                                new Discord.TextInputBuilder()
                                    .setCustomId(`input`)
                                    .setLabel(`Base64 input`)
                                    .setPlaceholder(`VGhpcyBiYXNlNjQgc3RyaW5nIHdpbGwgYmUgZGVjb2RlZCBpbnRvIHRleHQuLi4=`)
                                    .setStyle(Discord.TextInputStyle.Paragraph)
                                    .setMaxLength(900)
                                    .setRequired(true))
                        )
                    );
                }
                modalSubmit(modalId).then(async req2 => {
                    const input = req2.fields.getTextInputValue('input');
                    try {
                        if (subcmd == 'encode') {
                            const output = btoa(input);
                            req2.reply({
                                embeds: [
                                    new Discord.EmbedBuilder()
                                        .setColor(0x576ddb)
                                        .setTitle(`Text to Base64`)
                                        .addFields(
                                            { name: `Text input`, value: input },
                                            { name: `Base64 output`, value: output }
                                        )
                                ]
                            });
                        } else {
                            const output = atob(input);
                            req2.reply({
                                embeds: [
                                    new Discord.EmbedBuilder()
                                        .setColor(0x576ddb)
                                        .setTitle(`Base64 to Text`)
                                        .addFields(
                                            { name: `Base64 input`, value: input },
                                            { name: `Text output`, value: output }
                                        )
                                ]
                            });
                        }
                    } catch (error) {
                        req2.reply({
                            content: `Something went wrong!\n${error}`,
                            ephemeral: true
                        });
                    }
                }).catch(() => {});
            }
        },
        passgen: {
            builder: new Discord.SlashCommandBuilder()
                .setName('passgen')
                .setDescription(`Generate random, secure passwords.`)
                .addNumberOption(opt => opt
                    .setName('length')
                    .setDescription(`The length of the generated password, defaults to 12`)
                    .setMinValue(1)
                    .setMaxValue(128)),
            handler: (req) => {
                const length = req.options.getNumber('length') || 12;
                const bank = [
                    'ABCDEFGHJKLMNPQRSTUVWXYZ'.split(''), // No I or O
                    'abcdefghijklmnopqrstuvwxyz'.split(''),
                    '1234567890'.split(''),
                    '-=_+[]{};\':",.<>?*'.split('')
                ];
                const output = [];
                const usedSets = [];
                for (let i = 0; i < length; i++) {
                    const set = (() => {
                        while (true) {
                            const set = getRandomWeighted([
                                { value: bank[0], weight: 30 },
                                { value: bank[1], weight: 30 },
                                { value: bank[2], weight: 25 },
                                { value: bank[3], weight: 18 },
                            ]);
                            // Guarantee at least one character from each set
                            if (usedSets.length >= bank.length || !usedSets.includes(set))
                                return set;
                        }
                    })();
                    usedSets.push(set);
                    output.push(getRandomElement(set).replace(/\*/g, '\\*'));
                }
                req.reply({
                    embeds: [
                        new Discord.EmbedBuilder()
                            .setColor(0x576ddb)
                            .setAuthor({ name: `Password Generator` })
                            .setTitle(`${length}-character secure password`)
                            .setDescription(`Don't worry, generated passwords are discarded immediately after sending this message.`)
                            .addFields(
                                { name: `Password`, value: `||${output.join('')}||` }
                            )
                            .setFooter({ text: `Copy your password, then dismiss this message.` })
                    ],
                    ephemeral: true
                });
            }
        },
        stats: {
            builder: new Discord.SlashCommandBuilder()
                .setName('stats')
                .setDescription(`Get bot usage statistics.`),
            handler: (req) => {
                const commandsRun = (() => {
                    let total = 0;
                    Object.keys(usage.commands).forEach(key => {
                        total += usage.commands[key];
                    });
                    return total;
                })();
                req.reply({
                    embeds: [
                        new Discord.EmbedBuilder()
                            .setColor(0x57dbdb)
                            .setTitle(`Cybot usage statistics`)
                            .setDescription(`*Since <t:${Math.round(usage.start/1000)}:f>*`)
                            .addFields(
                                { name: `Global stats`, value: [
                                    `**${commandsRun}** commands run`,
                                    `**${usage.buttons}** buttons clicked`,
                                    `**${usage.modals}** modals submitted`,
                                    `**${usage.selects}** selections made`,
                                    `**${Object.keys(usage.users).length}** unique users`,
                                    `**Bot uptime:** ${formatSeconds((Date.now()-startTime)/1000)}`
                                ].join('\n'), inline: true },
                                { name: `Your stats`, value: [
                                    `**${usage.users[req.user.id].commands}** commands run`,
                                    `**${usage.users[req.user.id].buttons}** buttons clicked`,
                                    `**${usage.users[req.user.id].modals}** modals submitted`,
                                    `**${usage.users[req.user.id].selects}** selections made`
                                ].join('\n'), inline: true }
                            )
                    ]
                });
            }
        },
    }, config.client_id);

    // Parse slash command builders and output their "schemas" to a JSON file
    // This data will be used on the website to keep an up-to-date command list
    const builders = [];
    Object.keys(commands).forEach(key => {
        const builder = JSON.parse(JSON.stringify(commands[key].builder));
        if (!builder.options) return;
        const tmp = {
            name: key,
            desc: builder.description,
            opts: { required: [], optional: [] },
            subcommands: []
        };
        builder.options.forEach(opt => {
            if (opt.type === 1) {
                const subcmd = {
                    name: opt.name,
                    desc: opt.description,
                    opts: { required: [], optional: [] }
                };
                opt.options.forEach(opt2 => {
                    subcmd.opts[opt2.required ? 'required':'optional'].push({
                        name: opt2.name,
                        desc: opt2.description,
                    });
                });
                tmp.subcommands.push(subcmd);
            } else {
                tmp.opts[opt.required ? 'required':'optional'].push({
                    name: opt.name,
                    desc: opt.description,
                });
            }
        });
        builders.push(tmp);
    });
    // Aside: I realize I could've just directly saved each builder's JSON data,
    // but this way I can keep a consistent format with only the data I need
    writeJson('./web/main/commands.json', builders);

    // Track usage
    bot.on('interactionCreate', req => {
        if (!usage.users[req.user.id]) usage.users[req.user.id] = {
            commands: 0,
            buttons: 0,
            modals: 0,
            selects: 0
        };
        if (req.isChatInputCommand()) {
            if (!usage.commands[req.commandName]) usage.commands[req.commandName] = 0;
            usage.commands[req.commandName]++;
            usage.users[req.user.id].commands++;
        }
        if (req.isButton()) {
            usage.buttons++;
            usage.users[req.user.id].buttons++;
        }
        if (req.isModalSubmit()) {
            usage.modals++;
            usage.users[req.user.id].modals++;
        }
        if (req.isSelectMenu()) {
            usage.selects++;
            usage.users[req.user.id].selects++;
        }
        writeJson('usage.json', usage);
    });
}
main();