import * as express  from 'express';
const router = express.Router();

/* GET home page. */
router.get('/leaderboard', function(req, res, next) {
  res.render('index', { title: 'Express' });
});

export {
  router
}
