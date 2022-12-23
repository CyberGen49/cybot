
const Discord = require('discord.js');
const { randomInt } = require('web-resources');

let token;
let bot;
let isListeningForInteractions = false;

const commandHandlers = {};
const buttonResolve = {};
const modalResolve = {};
const selectMenuResolve = {};
const autocompleteHandlers = {};
const contextHandlers = {};

module.exports = {
    /**
     * @callback initializeBotReady
     * @param {Discord.Client} me The logged in Discord.js Client
     */
    /**
     * Initializes a Discord.js Client and logs into the bot using the provided token.
     * @param {Discord.ClientOptions} clientOptions Optiosn to provide to the Client constructor
     * @param {String} botToken Your Discord bot token
     * @param {initializeBotReady} [onReady] Called from within the bot's 'ready' event
     * @returns {Promise<Discord.Client>} The resulting Discord.js Client
     */
    initializeBot: (clientOptions, botToken, onReady = () => {}) => {
        return new Promise((resolve, reject) => {
            try {
                bot = new Discord.Client(clientOptions);
                bot.on('ready', async(me) => {
                    console.log(`Logged in as ${me.user.username}#${me.user.discriminator}`);
                    await onReady(me);
                    resolve(bot);
                });
                bot.login(botToken);
                token = botToken;
            } catch (error) { reject(error); }
        });
    },

    /**
     * Handle a Discord slash command interaction
     * @callback commandHandler
     * @param {Discord.Interaction} req The command interaction
     * @param {...*} [opts] Any extra goodies specific to this handler
     */
    /**
     * Handle a Discord autocomplete interaction
     * @callback autocompleteHandler
     * @param {Discord.Interaction} req The command interaction
     */
    /**
     * @typedef command
     * @type {Object}
     * @property {String} name The name of the command
     * @property {Discord.SlashCommandBuilder | Discord.ContextMenuCommandBuilder} builder The command's SlashCommandBuilder
     * @property {commandHandler} handler A handler for this command
     * @property {autocompleteHandler} [autocompleter] An optional autocompletion handler for this command
     * @property {Boolean} [isContextMenuCommand] If true, then this entry handles a context menu command and `builder` is a `ContextMenuCommandBuilder`
     */
    /**
     * @typedef buildCommandsReturn
     * @property {command[]} commands The provided list of commands
     */
    /**
     * Registers the provided commands with Discord and sets up their handlers to fire when corresponding interactions are received.
     * @param {Object.<string, command>} commands The commands
     * @param {String} clientId Your Discord client (application) ID
     * @returns {Promise<Object.<string, command>>}
     */
    buildCommands: (commands, clientId) => new Promise(async(resolve, reject) => {
        try {
            // Parse commands
            const builders = [];
            Object.keys(commands).forEach(name => {
                const command = commands[name];
                builders.push(command.builder);
                if (command.isContextMenuCommand) {
                    contextHandlers[name] = command.handler;
                } else {
                    commandHandlers[name] = command.handler;
                    if (command.autocompleter)
                        autocompleteHandlers[name] = command.autocompleter;
                }
            });
            // Register slash commands with Discord
            const api = new Discord.REST({ version: 10 }).setToken(token);
            const res = await api.put(Discord.Routes.applicationCommands(clientId), {
                body: builders
            });
            console.log(`Registered ${res.length} global slash commands`);
            // Start listening for interactions
            if (!isListeningForInteractions) {
                bot.on('interactionCreate', async(req) => {
                    if (req.isChatInputCommand()) {
                        try {
                            await commandHandlers[req.commandName](req);
                            console.log(`Handled ${req.user.username}#${req.user.discriminator}'s use of /${req.commandName}`);
                        } catch (error) {
                            console.error(`Error while handling slash command:`, error);
                            let method = 'reply';
                            if (req.replied) method = 'followUp';
                            if (req.deferred) method = 'editReply';
                            req[method]({ content: `Uhh, this is embarrassing:\n\`\`\`${error}\`\`\``, ephemeral: true })
                        }
                    }
                    if (req.isAutocomplete()) {
                        try {
                            await autocompleteHandlers[req.commandName](req);
                            console.log(`Handled ${req.user.username}#${req.user.discriminator}'s autocomplete for /${req.commandName}`);
                        } catch (error) {
                            console.error(`Error while handling autocomplete:`, error);
                        }
                    }
                    if (req.isModalSubmit()) {
                        try {
                            const func = modalResolve[req.customId];
                            delete modalResolve[req.customId];
                            await func(req);
                            console.log(`Handled ${req.user.username}#${req.user.discriminator}'s modal submission`);
                        } catch (error) {
                            req.reply({ content: `That modal is no longer valid.`, ephemeral: true });
                            console.error(`Error while handling modal submission:`, error);
                        }
                    }
                    if (req.isContextMenuCommand()) {
                        try {
                            await contextHandlers[req.commandName](req);
                            console.log(`Handled ${req.user.username}#${req.user.discriminator}'s use of context menu command: ${req.commandName}`);
                        } catch (error) {
                            console.error(`Error while handling context command:`, error);
                            req.reply({ content: `Uhh, this is embarrassing:\n\`\`\`${error}\`\`\`\nPlease make **Cyber#1000** aware of this error.`, ephemeral: true })
                        }
                    }
                    if (req.isButton()) {
                        try {
                            const func = buttonResolve[req.customId];
                            delete buttonResolve[req.customId];
                            await func(req);
                            console.log(`Handled ${req.user.username}#${req.user.discriminator}'s button click`);
                        } catch (error) {
                            req.reply({ content: `That button has expired. Try running the command again.`, ephemeral: true });
                            console.error(`Error while handling button:`, error);
                        }
                    }
                    if (req.isSelectMenu()) {
                        try {
                            const func = selectMenuResolve[req.customId];
                            delete selectMenuResolve[req.customId];
                            await func(req);
                            console.log(`Handled ${req.user.username}#${req.user.discriminator}'s select menu selection`);
                        } catch (error) {
                            req.reply({ content: `That selection has expired. Try running the command again.`, ephemeral: true });
                            console.error(`Error while handling button:`, error);
                        }
                    }
                });
                isListeningForInteractions = true;
                console.log(`Now listening for new interactions`);
            }
            // Resolve
            resolve(commands);
        // Reject if error
        } catch (error) { reject(error); }
    }),

    /**
     * Resolves when a button with the specified `customId` is clicked, and rejects when the button expires (after 15 minutes).
     * @param {String} id The button's set `customId`
     * @returns {Promise<Discord.Interaction>} The resulting Interaction
     */
    buttonClick: (id) => new Promise((resolve, reject) => {
        let expireTimeout;
        buttonResolve[id] = req => {
            clearTimeout(expireTimeout);
            resolve(req);
        };
        expireTimeout = setTimeout(() => {
            delete buttonResolve[id];
            reject(`This interaction has expired.`);
        }, 1000*60*15);
    }),
    /**
     * Resolves when a modal with the specified `customId` is submitted, and rejects when the modal expires (after 15 minutes).
     * @param {String} id The modal's set `customId`
     * @returns {Promise<Discord.Interaction>} The resulting Interaction
     */
    modalSubmit: (id) => new Promise((resolve, reject) => {
        let expireTimeout;
        modalResolve[id] = req => {
            clearTimeout(expireTimeout);
            resolve(req);
        };
        expireTimeout = setTimeout(() => {
            delete modalResolve[id];
            reject(`This interaction has expired.`);
        }, 1000*60*15);
    }),
    /**
     * Resolves when options in a select menu with the specified `customId` are selected, and rejects when the modal expires (after 15 minutes).
     * @param {String} id The modal's set `customId`
     * @returns {Promise<Discord.Interaction>} The resulting Interaction
     */
    selectMenuSelect: (id) => new Promise((resolve, reject) => {
        let expireTimeout;
        selectMenuResolve[id] = req => {
            clearTimeout(expireTimeout);
            resolve(req);
        };
        expireTimeout = setTimeout(() => {
            delete selectMenuResolve[id];
            reject(`This interaction has expired.`);
        }, 1000*60*15);
    }),

    /**
     * Returns the current timestamp as a string, followed by a dot and 3 random numbers.
     * @returns {String}
     */
     getBtnId: () => {
        let now = Date.now();
        return `${now}.${randomInt(100, 999)}`;
    }
};