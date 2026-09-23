import Book from '#models/book'

// Escrita que existe só no teste: não pode virar função da aplicação.
export const makeBook = () => Book.create({ title: 'x', authorId: 1 })
