
# Cybot Privacy Policy
This document seeks to detail, as transparently as possible, how the Cybot Discord bot processes user information. A markdown ([?](https://en.wikipedia.org/wiki/Markdown)) version of this document can be downloaded [here](./privacy.md).

Last revised on **November 11th, 2021**

## Persistent storage of user data
Most slash commands provided by Cybot make use of user-inputted information, but only some of these commands save this data for future use.

### Link shortener
The **/shortlink** command and its subcommands allow the user to create short links redirecting to URLs that they provide, optionally with a custom link ending. When a user creates a short link, a database entry is created with the following properties:

* The user's Discord ID (snowflake)
* The timestamp of creation
* The URL
* The short link ending that will redirect visitors to the target URL
* The title of the target webpage, if a title exists
* A value tracking the number of clicks this link has received
* A value determining whether or not the short link is disabled (described below)

For security purposes, a short link can neither be edited nor deleted after creation. If the user wishes to prevent access to one of their short links, they can use the **/shortlink disable** command to disable it. Disabled short links won't allow visitors to access the link's target URL, and will instead notify them that the link has been disabled.

### Website screenshot creator
The **/screenshot** command allows the user to get a screenshot of any website by providing a URL, along with optional image width and height attributes. Captured screenshots that are **over 8 megabytes in size** are saved to the server and made available under this website's `/content` endpoint so the user can download them.

### Feature request command
The **/request** command allows the user to submit requests for new slash commands. Upon submitting the modal provided by this command, the user's message is sent as a DM to the bot owner for further review.

### All other commands
For **all** slash commands other than those described above, any data provided by the user or generated within the interaction is discarded after the interaction is complete.

In the event that a command provides followup actions (modals, buttons, etc.), user input may persist until those actions have expired or been used. In these cases, the applicable data remains within the scope of that interaction and is **never** written to a file.

**Note:** For some commands, user inputs may be sent to a third-party service (API) for further processing. Those commands include:
* **/locateip**, which uses [ipapi.com's IP geolocation API](https://ipapi.com/),
* **/translate**, which uses [Google's Cloud Translation API](https://console.cloud.google.com/apis/api/translate.googleapis.com), and
* **/urbandefine**, which uses [a community-made Urban Dictionary API](https://rapidapi.com/community/api/urban-dictionary)

## Collection of usage data
Cybot collects bot usage data for statistical purposes. When a user uses a slash command, clicks a button, submits a modal, or selects an option from a selection menu, a counter for that action is incremented. These actions are linked to the user's Discord ID (snowflake), but only as numbers, with no context as to what commands were run or what inputs were used.

Any user can use the **/stats** command to view global bot statistics, along with their own usage. Users can only view their own individual stats, not those of other users.

## Further questions
Direct any questions that go unanswered by this document to **@Cyber#1000** on Discord.