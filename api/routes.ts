import * as express  from 'express';
import * as fs from 'fs';
import * as path from 'path';

import Debug from 'debug';
const log = Debug('api')

const router = express.Router();

const LEADERBOARD_FILE = path.join(__dirname, 'data', 'leaderboard.json')

router.get('/leaderboard', function(req, res, next) {
  res.setHeader('Content-Type', 'application/json');

  try {
    const content = fs.readFileSync(LEADERBOARD_FILE, { encoding: 'utf8' })
    const rows = JSON.parse(content)
    return res.json({ entries: rows })

  } catch(err: any) {
    console.error(`Error in /leaderboard`, err.toString())
    return res.json({entries: [] });
  }

  return res.json({entries: [] });
});

export {
  router
}
