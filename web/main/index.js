
window.addEventListener('load', async() => {
    const commands = await (await fetch('/commands.json')).json();
    commands.sort((a, b) => {
        return a.name.localeCompare(b.name, undefined, {
            numeric: true,
            sensitivity: 'base'
        });
    })
    let commandCount = 0;
    commands.forEach(cmd => {
        const insertBase = (name, desc) => {
            commandCount++;
            const bodyId = randomHex();
            _id('commands').insertAdjacentHTML('beforeend', `
                <div class="spoiler">
                    <div class="head">
                        <div class="col gap-5">
                            <h4>/${escapeHTML(name)}</h4>
                            <p>
                                ${escapeHTML(desc)}
                            </p>
                        </div>
                    </div>
                    <div id="${bodyId}" class="body col gap-10"></div>
                </div>
            `);
            return bodyId;
        }
        const insertOpts = (bodyId, opts) => {
            const getOptString = (name, desc) => `<p><code>${name}</code> — ${desc}</p>`;
            const required = [];
            opts.required.forEach(opt => {
                required.push(getOptString(opt.name, opt.desc));
            });
            const optional = [];
            opts.optional.forEach(opt => {
                optional.push(getOptString(opt.name, opt.desc));
            });
            if (required.length > 0) _id(bodyId).insertAdjacentHTML('beforeend', `
                <h5>Required parameters</h5>
                <div class="col gap-5">${required.join('\n')}</div>
            `);
            if (optional.length > 0) _id(bodyId).insertAdjacentHTML('beforeend', `
                <h5>Optional parameters</h5>
                <div class="col gap-5">${optional.join('\n')}</div>
            `);
            if (required.length+optional.length == 0)
                _id(bodyId).insertAdjacentHTML('beforeend', `
                    <h5><i>No parameters</i></h5>
                `);
        };
        if (cmd.subcommands.length > 0) {
            cmd.subcommands.forEach(subcmd => {
                const bodyId = insertBase(`${cmd.name} ${subcmd.name}`, subcmd.desc);
                insertOpts(bodyId, subcmd.opts);
            });
        } else {
            const bodyId = insertBase(cmd.name, cmd.desc);
            insertOpts(bodyId, cmd.opts);
        }
        _id('commandCount').innerText = commandCount;
    });
});