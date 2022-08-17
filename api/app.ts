import express = require('express')
import cors = require('cors')
import morgan = require('morgan')

import * as logics from './logics'

const logger = morgan('api')

import { router as indexRouter } from './routes'

const app = express();

app.use(logger);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

logics.setup();

app.use('/', indexRouter);

export {
  app
}
