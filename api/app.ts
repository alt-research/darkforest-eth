import express = require('express')
import cors = require('cors')
import morgan = require('morgan')

import * as logics from './logics'

import { router as indexRouter } from './routes'

const app = express();

app.use(morgan('short'));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

logics.setup();

app.use('/', indexRouter);

// This is the 404 error
app.use(function(req, res, next) {
  return res.status(404).json({ error: "Invalid path" })
});

export {
  app
}
