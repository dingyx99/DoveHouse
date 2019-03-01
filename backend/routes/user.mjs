import KoaRouter from '@circuitcoder/koa-router';

import request from '../request';

import User from '../db/user';

import { generateJWT } from '../util';
import Config from '../config';

import { promisify } from 'util';
import crypto from 'crypto';
import mailer from '../mailer';

const randomBytes = promisify(crypto.randomBytes);

const router = new KoaRouter();

// Register
router.post('/', async ctx => {
  const { email, pass, realname } = ctx.request.body;

  const token = (await randomBytes(24)).toString('hex');
  const user = new User({ email, realname, token });
  await user.setPass(pass);

  try {
    await user.save();
  } catch(e) {
    if(e.name === 'MongoError' && e.code === 11000) {
      // Duplicated
      ctx.status = 400;
      ctx.body = { err: 'duplicated' };
      return;
    }

    throw e;
  }

  await mailer.send(email, '请验证您的注册', 'reg', {
    name: realname,
    link: `${Config.base}/user/verify/${token}`,
  });
  const jwt = await generateJWT(user._id.toString());

  ctx.status = 201;
  return ctx.body = { token: jwt };
});

// Match id and self
const matcher = async (ctx, next) => {
  if(ctx.params.id)
    if(ctx.uid !== ctx.params.id && !ctx.user.isAdmin)
      return ctx.status = 403;

  await next();
};

router.get('/verify/:token', matcher, async ctx => {
  const result = await User.findOneAndUpdate({
    token: ctx.params.token,
  }, {
    $set: {
      token: null,
      status: 'verified',
    },
  });

  if(!result) return ctx.status = 404;
  return ctx.body = '验证成功，您可以关闭此页面了';
});

router.post('/:id/profile', matcher, async ctx => {
  const { profile } = ctx.request.body;

  const reuslt = await User.findOneAndUpdate({
    _id: ctx.params.id,
  }, {
    $set: {
      profile,
    }
  });

  if(!result) return ctx.status = 404;
  return ctx.status = 204;
});

// TODO: update realname

router.post('/:id/idNumber', matcher, async ctx => {
  const { idNumber } = ctx.request.body;

  const user = await User.findById(ctx.params.id);
  if(!user) return ctx.status = 404;

  const resp = await request.post('https://api.yonyoucloud.com/apis/dst/matchIdentity/matchIdentity', {
    json: true,
    headers: {
      apicode: Config.apikeys.idverify,
    },
    body: {
      idNumber,
      userName: user.realname,
    },
  });

  if(!resp.success) {
    ctx.status = 400;
    return ctx.body = { err: resp.message };
  }

  user.idNumber = idNumber;
  await user.save(); // Optimistic lock

  return ctx.status = 204;
});

export default router;
