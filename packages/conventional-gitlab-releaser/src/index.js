'use strict'

const assign = require('object-assign')
const conventionalChangelog = require('conventional-changelog')
const escape = require('querystring').escape
const gitSemverTags = require('git-semver-tags')
const glGot = require('gl-got')
const merge = require('lodash.merge')
const Q = require('q')
const through = require('through2')
const transform = require('./transform')

/* eslint max-params: ["error", 7] */
function conventionalGitlabReleaser (auth, changelogOpts, context, gitRawCommitsOpts, parserOpts, writerOpts, userCb) {
  if (!auth) {
    throw new Error('Expected an auth object')
  }

  const promises = []

  const changelogArgs = [changelogOpts, context, gitRawCommitsOpts, parserOpts, writerOpts].map(function (arg) {
    if (typeof arg === 'function') {
      userCb = arg
      return {}
    }
    return arg || {}
  })

  if (!userCb) {
    throw new Error('Expected an callback')
  }

  changelogOpts = changelogArgs[0]
  context = changelogArgs[1]
  gitRawCommitsOpts = changelogArgs[2]
  parserOpts = changelogArgs[3]
  writerOpts = changelogArgs[4]

  changelogOpts = merge({
    transform: transform,
    releaseCount: 1
  }, changelogOpts)

  writerOpts.includeDetails = true

  // ignore the default header partial
  writerOpts.headerPartial = writerOpts.headerPartial || ''

  let endpoint = `${auth.url}/api/v4/`

  Q.nfcall(gitSemverTags)
    .then(function (tags) {
      if (!tags || !tags.length) {
        setImmediate(userCb, new Error('No semver tags found'))
        return
      }

      const releaseCount = changelogOpts.releaseCount
      if (releaseCount !== 0) {
        gitRawCommitsOpts = assign({
          from: tags[releaseCount]
        }, gitRawCommitsOpts)
      }

      gitRawCommitsOpts.to = gitRawCommitsOpts.to || tags[0]
    })
    .then(() => glGot(`version`, {token: auth.token, endpoint}))
    .catch(() => {
      endpoint = `${auth.url}/api/v3/`
    })
    .then(() => {
      conventionalChangelog(changelogOpts, context, gitRawCommitsOpts, parserOpts, writerOpts)
        .on('error', function (err) {
          userCb(err)
        })
        .pipe(through.obj(function (chunk, enc, cb) {
          if (!chunk.keyCommit || !chunk.keyCommit.version) {
            cb()
            return
          }

          const promise = glGot('projects/' + escape(context.owner + '/' + context.repository) + '/repository/tags', {
            token: auth.token,
            endpoint,
            body: {
              tag_name: chunk.keyCommit.version,
              ref: chunk.keyCommit.hash,
              message: 'Release ' + chunk.keyCommit.version,
              release_description: chunk.log
            }
          })

          promises.push(promise)

          cb()
        }, function () {
          Q.all(promises)
            .then(function (responses) {
              userCb(null, responses)
            })
            .catch(function (err) {
              userCb(err)
            })
        }))
    })
    .catch(function (err) {
      userCb(err)
    })
}

module.exports = conventionalGitlabReleaser
