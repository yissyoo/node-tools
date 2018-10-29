let _ = require('lodash');
let net = require('net');
let child_process = require('child_process');
let ws = require('ws');
let path = require('path');
let fs = require('fs');

let dir = path.join(path.dirname(process.argv[1]), 'exe');

let exe = path.join(dir, 'shadowsocks-libqss.exe');
if (!fs.existsSync(exe)) return process.stderr.write(`File not exists: ${exe}\n`);

let profiles = path.join(dir, 'jumper-client.json');
if (!fs.existsSync(profiles)) return process.stderr.write(`File not exists: ${profiles}\n`);
profiles = fs.readFileSync(profiles, { encoding: 'utf8' });
profiles = JSON.parse(profiles);

function on_local_socket(profile, target, localSocket) {
    let ep = Buffer.from('ep:' + target).toString('base64').replace(/\+/g, '*').replace(/\//g, '_');
    let webSocket = new ws(profile.host + 'wapi/ws/' + ep);
    let log = msg => process.stdout.write(`[${profile.name} - ${target}] ${msg}\n`);
    log('Connection to server...');
    webSocket.on('open', () => {
        log('Server connected.')
        webSocket.on('message', data => {
            //log(`Client < Server (${data.length})`);
            localSocket.write(data);
        });
        localSocket.on('data', data => {
            //log(`Client > Server (${data.length})`);
            webSocket.send(data);
        });
    });

    let close_both = () => {
        if (!localSocket.destroyed) localSocket.destroy();
        webSocket.close();
    };

    webSocket.on('error', error => {
        log('Server error: ' + error.message);
        close_both();
    });
    localSocket.on('error', error => {
        log('Client error: ' + error.message);
        close_both();
    });
    webSocket.on('close', () => {
        log('Server Closed');
        close_both();
    });
    localSocket.on('close', () => {
        log('Client Closed');
        close_both();
    });
}

function print_binding() {
    let max_len_target = _.chain(profiles).map(p => p.targets).flattenDeep().filter(t => t.parts).maxBy(t => t.parts[1].length).value().parts[1].length;
    _.map(profiles, p => {
        _.map(p.targets, t => {
            if (!t.parts) return;
            let target = t.parts[1];
            target += ' '.repeat(max_len_target + 4 - target.length);
            if (t.success) {
                process.stdout.write(`${t.parts[0]}\t${target}${p.name} - ${t.parts[2]}\n`);
                if (t.port_socks5) process.stdout.write(`${t.port_socks5}\t${target}${p.name} - SS-SOCKS5\n`);
            }
            else process.stderr.write(`${t.parts[0]}\t${target}${p.name} - ${t.parts[2]}\n`);
        });
        process.stdout.write('\n');
    });
}

let target_counts = 0;
_.map(profiles, p => _.map(p.targets, (t, index) => {
    let parts = /^(\d+),([^,]+),(.+)$/.exec(t);
    if (!parts) return;

    parts = _.drop(parts, 1);
    let port = parseInt(parts[0]);

    target_counts++;

    let server = net.createServer(localSocket => on_local_socket(p, parts[1], localSocket));
    server.on('error', error => {
        if (error.code == 'EADDRINUSE') {
            p.targets[index] = { parts, success: false };
            if (--target_counts == 0) print_binding();
        }
    })
    server.listen(port, '0.0.0.0', () => {
        let target = p.targets[index] = { parts, success: true };
        let ss = /^ss-(.+)$/i.exec(parts[2]);
        if (!ss) {
            if (--target_counts == 0) print_binding();
        } else {
            let port_socks5 = port + 1;
            child_process.exec(_.filter([exe, '-m', 'aes-128-cfb', '-t', '600', '-k', ss[1], '-s', '127.0.0.1', '-p', port, '-b', '0.0.0.0', '-l', port_socks5], a => '"' + a + '"').join(' '));
            target.port_socks5 = port_socks5;

            if (--target_counts == 0) print_binding();
        }
    });
}));

setInterval(_.noop, 1000);
