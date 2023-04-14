const exec = require('child_process');
const fs = require('fs');
const jssoup = require('jssoup').default;
const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
require('dotenv').config();

const validNames = ["peter", "feedc0de", "feedc0de_new", "mick", "seatbot", "comred_new"];

const app = express();
app.use(bodyParser.json());

// verify webhook via X-Hub-Signature-256 Header and process.env.GITHUB_TOKEN
app.use(function (req, res, next) {
    const body = JSON.stringify(req.body);
    if (!body) {
        return next('Request body empty')
    }

    const sig = Buffer.from(req.get("X-Hub-Signature-256") || '', 'utf8')
    const hmac = crypto.createHmac("sha256", process.env.GITHUB_TOKEN)
    const digest = Buffer.from("sha256" + '=' + hmac.update(body).digest('hex'), 'utf8')
    if (sig.length !== digest.length || !crypto.timingSafeEqual(digest, sig)) {
        console.log(`Request body digest (${digest}) did not match X-Hub-Signature-256 (${sig})`)
        res.status(403).send('Request body digest did not match X-Hub-Signature-256')
        return;
    }
    console.log(`"X-Hub-Signature-256" verified`)
    return next()
});

app.post('/gh-webhook', (req, res) => {
    try {
        res.sendStatus(200);
        const startTime = (new Date()).getTime();
        const data = req.body;
        const workflow_name = data.workflow_run.name;
        const workflow_event = data.workflow_run.event;
        const workflow_file = data.workflow.path;
        const workflow = workflow_file.split('/').pop().replace('.yml', '');

        const status = data.workflow_run.status;
        const conclusion = data.workflow_run.conclusion;
        const head_sha = data.workflow_run.head_sha;
        const short_sha = head_sha.substring(0, 7);
        const branch = encodeURIComponent(data.workflow_run.head_branch);

        if (workflow_name != "CI") {
            console.log(`Workflow name is not "CI"`);
            return;
        }

        if (workflow_event != "push") {
            console.log("Only pushes are supported");
        }

        console.log(`status: ${status}; conclusion: ${conclusion}`);

        if (status === 'completed' && conclusion === 'success') {

            // using nightly.link
            const url = `https://nightly.link/bobbycar-graz/bobbycar-boardcomputer-firmware/workflows/${workflow}/${branch}`;

            console.log(url);

            // get url
            const html = exec.execSync(`curl -s ${url}`).toString();
            const soup = new jssoup(html);

            // td>[rel=nofollow]
            const url_tags = soup.findAll('a', { 'rel': 'nofollow' });
            var zip_urls = [];

            for (index in url_tags) {
                const tag = url_tags[index];
                if (tag.attrs.href.includes(".zip")) {
                    zip_urls.push(tag.attrs.href);
                }
            }

            console.log('Zip urls:', zip_urls);

            // download zips into /home/github/tmp/{username}/{short_sha}.{branch}.zip
            for (index in zip_urls) {
                const url = zip_urls[index];
                const zip_name = url.substring(url.lastIndexOf('/') + 1);
                const name = zip_name.replace(".zip", "").replace("bobbyquad_", "");

                if (!validNames.includes(name) || branch.includes(".") || short_sha.includes(".")) {
                    // skipping mallicious files
                    console.warn(`skipping ${name}`);
                    continue;
                }

                const zip_path = `/home/github/tmp/${name}-${short_sha}/${short_sha}.${branch}.${name}.zip`;
                exec.execSync(`rm -rf /home/github/tmp/${name}-${short_sha}`);
                exec.execSync(`mkdir -p /home/github/tmp/${name}-${short_sha}`);
                console.log(`Downloading ${url}`);
                exec.execSync(`wget -q -O ${zip_path} ${url}`);
                console.log(`Downloaded ${zip_path} (${url})`);

                // unzip
                try {
                    exec.execSync(`unzip -o ${zip_path} -d /home/github/tmp/${name}-${short_sha}/`);
                    exec.execSync(`rm ${zip_path}`);
                } catch (e) {
                    console.error(`Failed to unzip ${zip_path}`);
                    // list directory
                    exec.execSync('tree /home/github/tmp/');
                    continue;
                }

                // prepare files
                // rename bobbyquad_${name}.bin into ${short_sha}.${branch}.${name}.bin
                exec.execSync(`mv /home/github/tmp/${name}-${short_sha}/bobbyquad_${name}.bin /home/github/tmp/${name}-${short_sha}/${short_sha}.${branch}.${name}.bin`);
                if (process.env.DOWNLOAD_ELF == "true" || process.env.DOWNLOAD_ELF == "1" || process.env.DOWNLOAD_ELF == true) {
                    exec.execSync(`mv /home/github/tmp/${name}-${short_sha}/bobbyquad_${name}.elf /home/github/tmp/${name}-${short_sha}/${short_sha}.${branch}.${name}.elf`);
                }

                // move files into /home/github/builds/${name}/
                exec.execSync(`mkdir -p /home/github/builds/${name}/`);
                exec.execSync(`mv /home/github/tmp/${name}-${short_sha}/${short_sha}.${branch}.${name}.bin /home/github/builds/${name}/${short_sha}.${branch}.bin`);
                if (process.env.DOWNLOAD_ELF == "true" || process.env.DOWNLOAD_ELF == "1" || process.env.DOWNLOAD_ELF == true) {
                    exec.execSync(`mv /home/github/tmp/${name}-${short_sha}/${short_sha}.${branch}.${name}.elf /home/github/builds/${name}/${short_sha}.${branch}.elf`);
                }

                // symlinks
                exec.execSync(`rm -f /home/github/builds/${name}/${branch}.latest.bin`);
                exec.execSync(`rm -f /home/github/builds/${name}/latest.bin`);
                exec.execSync(`ln -s /home/github/builds/${name}/${short_sha}.${branch}.bin /home/github/builds/${name}/${branch}.latest.bin`);
                exec.execSync(`ln -s /home/github/builds/${name}/${short_sha}.${branch}.bin /home/github/builds/${name}/latest.bin`);

                // clean up
                exec.execSync(`rm -rf /home/github/tmp/${name}-${short_sha}`);
            }
        }

        let time = ((new Date()).getTime() - startTime) / 1000;
        console.log(`Webhook finished in ${time}s`);

        // git pull
        const pullStartTime = (new Date()).getTime();
        console.log('Executing "git pull"...');
        exec.execSync(`cd /home/github/bobbycar-boardcomputer-firmware/ && git pull --all && git submodule update --init --recursive`);
        time = ((new Date()).getTime() - pullStartTime) / 1000;
        console.log(`Git pull finished in ${time}s`);
    } catch (e) {
        console.error(e);
        console.log(req.body);
    }
});

app.listen(42422, '127.0.0.1');
console.log('Listening on port 42422');
