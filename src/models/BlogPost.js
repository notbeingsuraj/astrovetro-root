/* -------------------------------------------------------------------------
   BlogPost
   -------------------------------------------------------------------------

   The journal, made manageable. Field names deliberately mirror the static
   `articles` records in src/data/catalogue.js (`image`, `readingTime`,
   `publishedAt`) so the existing journal and article pages do not need a
   different contract when the source moves from the catalogue to the database.

   `content` is plain text: paragraphs separated by blank lines. The public
   article page already renders it through textContent and escaping, so a post
   cannot inject markup. The admin editor is a textarea for the same reason.

   Lifecycle: draft / active / archived. Drafts are never returned by public
   reads. Publishing an already-published post does not move its original
   publication date.
   ------------------------------------------------------------------------- */

import mongoose from 'mongoose';

const blogPostSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    previousSlugs: { type: [String], default: [] },

    excerpt: { type: String, default: '', maxlength: 500 },
    content: { type: String, default: '', maxlength: 40000 },
    image: { type: String, default: '' },
    imageAlt: { type: String, default: '', maxlength: 300 },

    author: { type: String, default: 'Astro Vetro', maxlength: 120 },
    category: { type: String, default: 'journal', maxlength: 80, index: true },
    tags: { type: [String], default: [] },
    featured: { type: Boolean, default: false, index: true },

    status: { type: String, enum: ['draft', 'active', 'archived'], default: 'draft', index: true },
    publishedAt: { type: Date, default: null },

    seoTitle: { type: String, default: '', maxlength: 70 },
    seoDescription: { type: String, default: '', maxlength: 170 },
  },
  { timestamps: true }
);

blogPostSchema.index({ status: 1, publishedAt: -1 });

const readingTime = (text) => Math.max(1, Math.ceil(String(text || '').trim().split(/\s+/).filter(Boolean).length / 220));

blogPostSchema.methods.toPublic = function toPublic({ related = [] } = {}) {
  return {
    id: this._id.toString(),
    slug: this.slug,
    title: this.title,
    category: this.category,
    excerpt: this.excerpt,
    content: this.content,
    image: this.image || null,
    imageAlt: this.imageAlt,
    readingTime: readingTime(this.content),
    author: this.author,
    featured: this.featured,
    tags: this.tags,
    publishedAt: this.publishedAt,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
    seoTitle: this.seoTitle,
    seoDescription: this.seoDescription,
    related,
  };
};

blogPostSchema.methods.toAdmin = function toAdmin() {
  return {
    ...this.toPublic(),
    status: this.status,
    previousSlugs: this.previousSlugs,
    seoTitle: this.seoTitle,
    seoDescription: this.seoDescription,
  };
};

export const BlogPost = mongoose.model('BlogPost', blogPostSchema);
export default BlogPost;
