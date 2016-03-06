import Q from 'q';
import uuid from 'node-uuid';
import PouchDB from 'pouchdb';
import PouchDBFind from 'pouchdb-find'
PouchDB.plugin(PouchDBFind);

window.PouchDB = PouchDB;

const TYPE_POST = 'post';
let db;// = new PouchDB('hubpress');

export function pouchDbPlugin (hubpress) {

  hubpress.on('requestLocalSynchronization', (opts) => {
    const posts = opts.data.documents.posts || [];

    const postPromises = posts.map((post) => {

      return function getPost (completePosts = []) {
        const defer = Q.defer();
        delete post._links;
        db.find({
          selector: {'original.name': {$eq: post.name}, type: {$eq: TYPE_POST}},
          limit: 1
        })
        .then( (values) => {
          const existingPost = values.docs[0]
          if (!values.docs.length) {
            post._id = uuid.v4();
            post.type = TYPE_POST;
            // Doc not found
            db.put(post)
            .then( (result) => {
              post._rev = result.rev;
              completePosts.push(post);
              defer.resolve(completePosts);
            })
            .catch((e) => {
              defer.reject(e);
            });
          }
          else {
            const existingPost = values.docs[0];
            if (existingPost.original && existingPost.original.content !== post.content || existingPost.published !== post.published) {
              post._id = existingPost._id;
              post._rev = existingPost._rev;
              post.type = TYPE_POST;
              db.put(post)
                .then( () => {
                  post._rev = existingPost._rev;
                  completePosts.push(post)
                  defer.resolve(completePosts);
                })
                .catch( (e) => {
                  defer.reject(e);
                });
            }
            else {
              post._id = existingPost._id;
              post._rev = existingPost._rev;
              post.type = TYPE_POST;
              completePosts.push(post)
              defer.resolve(completePosts);
            }
          }
        })

        return defer.promise;
      }
    });

    const reducePromise = (postPromises || [])
      .reduce((memo, promise) => memo.then(promise), Q([]));

    return reducePromise.then( (posts) => {
      const mergeDocuments = Object.assign({}, {posts}, opts.data.documents);
      const data = Object.assign({}, opts.data, {documents: mergeDocuments});
      return Object.assign({}, opts, {data});
    })

  })

  hubpress.on('receiveConfig', (opts) => {
    db = new PouchDB('hubpress-' + opts.data.config.meta.username+'-'+opts.data.config.meta.repositoryName);

    db.info().then((data) => {
      console.log('PouchDB infos', data)
    });

    return db.createIndex({
      index: {fields: ['name', 'type']}
    }).
    then(() => db.createIndex({
      index: {fields: ['original.name', 'type']}
    })).
    then(() => db.createIndex({
      index: {fields: ['published', 'type']}
    })).
    then(() => db.createIndex({
      index: {fields: ['original.name', 'published', 'type']}
    })).
    then(() => opts);
  })

  hubpress.on('requestLocalPosts', (opts) => {

    return db.find({
      selector: {name: {$gt: null}, type: {$eq: TYPE_POST}},
      sort: [{'name':'desc'}]
    })
    .then( (posts) => {
      const data = Object.assign({}, opts.data, {posts: posts.docs});
      return Object.assign({}, opts, {data});
    });

  })

  hubpress.on('requestSelectedPost', (opts) => {
    console.log(opts);
    return db.get(opts.data.post._id)
    .then( (selectedPost) => {
      const data = Object.assign({}, opts.data, {selectedPost});
      return Object.assign({}, opts, {data});
    });

  })

  hubpress.on('requestLocalPost', (opts) => {
    const defer = Q.defer();
    console.log(opts);
    db.get(opts.data.post._id)
    .then( (post) => {
      const data = Object.assign({}, opts.data, {post});
      defer.resolve(Object.assign({}, opts, {data}));
    })
    .catch(e => {
      if (e.status === 404) {
        const data = Object.assign({}, opts.data, {
          post: {
            _id: opts.data.post._id
          }
        });
        defer.resolve(Object.assign({}, opts, {data}));
      }
      else {
        defer.reject(e);
      }
    });
    return defer.promise;

  })

  hubpress.on('requestSaveLocalPost', (opts) => {
    console.log('requestSaveLocalPost',opts);
    const defer = Q.defer();

    db.find({
      selector: {_id: {$ne: opts.data.post._id }, name: {$eq: opts.data.post.name}, type: {$eq: TYPE_POST}},
      limit: 1
    })
    .then( (posts) => {
      if (posts.docs.length) {
        throw new Error(`Post with the name ${opts.data.post.name} already exist`);
      }
      else {
        return opts.data.post._id;
      }
    })
    .then(id => db.get(id))
    .then( (post) => {
      const mergedPost = Object.assign({}, post, opts.data.post);
      mergedPost._rev = post._rev;
      mergedPost.type = TYPE_POST;
      db.put(mergedPost)
      .then(result => {
        mergedPost._rev = result.rev;
        const data = Object.assign({}, opts.data, {post: mergedPost});
        defer.resolve(Object.assign({}, opts, {data}));
      })
      .catch(e => defer.reject(e));
    })
    .catch(e => {
      if (e.status === 404) {
        const docToSave = Object.assign({}, opts.data.post);
        db.put(docToSave)
        .then(result => {
          docToSave._rev = result.rev;
          const data = Object.assign({}, opts.data, {post: docToSave});
          defer.resolve(Object.assign({}, opts, {data}));

        })
        .catch(e => defer.reject(e));
      }
      else {
        defer.reject(e);
      }
    });

    return defer.promise
  })

  hubpress.on('requestLocalPublishedPosts', opts => {
    console.log('requestLocalPublishedPosts ++ ', opts);
    return db.find({
      selector: {'original.name': {$gt: null}, published: {$eq: 1 }, type: {$eq: TYPE_POST}},
      sort: [{'original.name':'desc'}]
    })
    .then(result => {
      console.log('requestLocalPublishedPosts => ', result);
      const data = Object.assign({}, opts.data, {publishedPosts: result.docs});
      return Object.assign({}, opts, {data});
    })
  })

  hubpress.on('requestDeleteLocalPost', opts => {
    console.log('requestDeleteLocalPost ++ ', opts);
    return db.remove(opts.data.post._id, opts.data.post._rev)
    .then(result => {
      return opts;
    })
  })
}
